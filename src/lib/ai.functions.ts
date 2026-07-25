import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAI, dataUrlToBytes, enrichWithMlb, extractJson, scanViaAIVision } from "./ai.server";

// ---------- Photo scan: Ximilar identify, AI fallback ----------
export const scanCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { bytes, contentType } = dataUrlToBytes(data.imageDataUrl);

    // 1) Ximilar identify.
    try {
      const { identifyCardXimilar } = await import("./ximilar.server");
      const ident = await identifyCardXimilar(bytes, contentType);
      if (ident?.player_name) {
        const enriched = await enrichWithMlb({
          player_name: ident.player_name,
          team: ident.team,
          position: ident.position,
          year: ident.year,
          set_name: ident.set_name,
          card_number: ident.card_number,
          grade: null,
          grader: null,
          confidence: "high",
          cardsight_card_id: null,
        });
        return enriched;
      }
    } catch (err) {
      console.error("Ximilar identify failed:", err);
    }

    // 2) Fallback: direct AI vision on the original data URL.
    const result = await scanViaAIVision(data.imageDataUrl);
    return enrichWithMlb(result);
  });

// ---------- Value estimate ----------
// Primary path: Ximilar `sport_id` with `price_stats: true` on the card's
// stored photo. AI narrative fallback when Ximilar has no pricing.
export const estimateCardValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        player_name: z.string().min(1),
        year: z.number().int().optional().nullable(),
        set_name: z.string().optional().nullable(),
        card_number: z.string().optional().nullable(),
        grade: z.string().optional().nullable(),
        grader: z.string().optional().nullable(),
        is_autograph: z.boolean().optional().nullable(),
        is_first_bowman: z.boolean().optional().nullable(),
        serial_number: z.string().optional().nullable(),
        // Accepted for backward compat — ignored.
        cardsight_card_id: z.string().uuid().optional().nullable(),
        cardsight_parallel_id: z.string().uuid().optional().nullable(),
        cardsight_grade_id: z.string().uuid().optional().nullable(),
        card_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let usedXimilar = false;
    let sales: Array<{
      sold_at: string | null;
      grade: string | null;
      price: number;
      source: string;
      url: string | null;
    }> = [];
    let currentValue = 0;
    let deltaPct = 0;
    let compsNote: string | null = null;
    let history: Array<{ recorded_at: string; value: number }> = [];

    // Attempt Ximilar pricing from the card's stored photo.
    if (data.card_id) {
      try {
        const { data: card } = await context.supabase
          .from("cards")
          .select("photo_url")
          .eq("id", data.card_id)
          .maybeSingle();
        const rawPhoto = card?.photo_url ?? null;
        if (rawPhoto) {
          const { pricingFromXimilarByUrl, pricingFromXimilarByBytes, XimilarAuthError } = await import(
            "./ximilar.server"
          );
          let pricing = null as Awaited<ReturnType<typeof pricingFromXimilarByUrl>>;
          if (rawPhoto.startsWith("http")) {
            pricing = await pricingFromXimilarByUrl(rawPhoto, {
              grader: data.grader,
              grade: data.grade,
            });
          } else {
            const { data: file } = await context.supabase.storage
              .from("card-photos")
              .createSignedUrl(rawPhoto, 60 * 10);
            if (file?.signedUrl) {
              try {
                pricing = await pricingFromXimilarByUrl(file.signedUrl, {
                  grader: data.grader,
                  grade: data.grade,
                });
              } catch (err) {
                if (err instanceof XimilarAuthError || (err instanceof Error && err.name === "XimilarAuthError")) {
                  throw err;
                }
                console.error("Ximilar pricing by URL failed, falling back to bytes:", err);
                const { data: blob } = await context.supabase.storage
                  .from("card-photos")
                  .download(rawPhoto);
                if (blob) {
                  const bytes = new Uint8Array(await blob.arrayBuffer());
                  pricing = await pricingFromXimilarByBytes(bytes, blob.type || "image/jpeg", {
                    grader: data.grader,
                    grade: data.grade,
                  });
                }
              }
            }
          }
          if (pricing && pricing.current_value > 0) {
            currentValue = pricing.current_value;
            deltaPct = pricing.value_delta_pct;
            sales = pricing.sales;
            history = pricing.history;
            usedXimilar = true;
          } else {
            compsNote = "Ximilar had no market data for this card — using AI estimate.";
          }
        } else {
          compsNote = "No photo on file to send to Ximilar — using AI estimate.";
        }
      } catch (err) {
        console.error("Ximilar pricing failed:", err);
        if (err instanceof Error && err.name === "XimilarAuthError") {
          throw err;
        }
        compsNote = err instanceof Error ? err.message : "Ximilar pricing failed";
      }
    }

    if (usedXimilar) {
      return {
        current_value: currentValue,
        value_delta_pct: deltaPct,
        sales,
        history,
        source: "ximilar" as const,
        note: compsNote,
        resolved_cardsight_card_id: null as string | null,
        resolved_cardsight_grade_id: null as string | null,
      };
    }

    // AI narrative fallback + history spark data.
    const variantBits = [
      data.is_autograph ? "autograph" : null,
      data.serial_number ? `#/${data.serial_number.replace(/^.*\//, "")}` : null,
    ].filter(Boolean);
    const descriptor = [
      data.year,
      data.set_name,
      data.player_name,
      data.card_number ? `#${data.card_number}` : null,
      ...variantBits,
      data.grader && data.grade ? `${data.grader} ${data.grade}` : data.grade,
    ]
      .filter(Boolean)
      .join(" ");

    const prompt = `Give a realistic current secondary-market value estimate (USD) for this sports card: "${descriptor}". Also give a plausible 30-day percent change and 6 monthly historical value data points ending today. Return JSON ONLY:
{
  "current_value": number,
  "value_delta_pct": number,
  "history": [{"recorded_at": "YYYY-MM-DDTHH:mm:ssZ", "value": number}]
}
If unable to value, return current_value: 0.`;

    const text = await callAI({
      model: "google/gemini-3.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are an experienced sports card market analyst. Provide realistic market value estimates. Reply ONLY with JSON — no prose.",
        },
        { role: "user", content: prompt },
      ],
    });

    const ai = extractJson<{
      current_value: number;
      value_delta_pct: number;
      history: Array<{ recorded_at: string; value: number }>;
    }>(text);

    return {
      current_value: ai.current_value,
      value_delta_pct: ai.value_delta_pct,
      sales,
      history: ai.history,
      source: "ai" as const,
      note: compsNote,
      resolved_cardsight_card_id: null as string | null,
      resolved_cardsight_grade_id: null as string | null,
    };
  });
