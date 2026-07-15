import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.5-flash";

async function callAI(body: unknown): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("Rate limit — try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted. Please add credits.");
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON");
  return JSON.parse(match[0]) as T;
}

// ---------- Photo scan: extract card details from an image ----------
export const scanCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }) => {
    const text = await callAI({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a baseball card identification expert. Extract details from card photos. Reply ONLY with a JSON object matching the requested schema — no prose.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Identify this baseball card. Return JSON: {\"player_name\": string, \"team\": string|null, \"position\": string|null, \"year\": number|null, \"set_name\": string|null, \"card_number\": string|null, \"grade\": string|null, \"grader\": string|null, \"confidence\": \"high\"|\"medium\"|\"low\"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null.",
            },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
    });
    return extractJson<{
      player_name: string;
      team: string | null;
      position: string | null;
      year: number | null;
      set_name: string | null;
      card_number: string | null;
      grade: string | null;
      grader: string | null;
      confidence: "high" | "medium" | "low";
    }>(text);
  });

// ---------- Value estimate + comparable sales (AI estimate) ----------
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
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const descriptor = [
      data.year,
      data.set_name,
      data.player_name,
      data.card_number ? `#${data.card_number}` : null,
      data.grader && data.grade ? `${data.grader} ${data.grade}` : data.grade,
    ]
      .filter(Boolean)
      .join(" ");

    const prompt = `Give a realistic current secondary-market value estimate (USD) for this baseball card: "${descriptor}". Also give a plausible 30-day percent change, 5 recent comparable sales (fabricated but plausible), and 6 monthly historical value data points ending today. Return JSON ONLY:
{
  "current_value": number,
  "value_delta_pct": number,
  "sales": [{"sold_at": "YYYY-MM-DD", "grade": string|null, "price": number, "source": "eBay"|"PWCC"|"Goldin"|"Heritage", "url": null}],
  "history": [{"recorded_at": "YYYY-MM-DDTHH:mm:ssZ", "value": number}]
}
If unable to value, return current_value: 0.`;

    const text = await callAI({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an experienced sports card market analyst. Provide realistic market value estimates. Reply ONLY with JSON — no prose.",
        },
        { role: "user", content: prompt },
      ],
    });

    return extractJson<{
      current_value: number;
      value_delta_pct: number;
      sales: Array<{ sold_at: string; grade: string | null; price: number; source: string; url: string | null }>;
      history: Array<{ recorded_at: string; value: number }>;
    }>(text);
  });
