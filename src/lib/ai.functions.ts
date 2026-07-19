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
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("AI did not return JSON");
  const openCh = cleaned[start];
  const closeCh = openCh === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error("AI JSON not balanced");
  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    const repaired = slice.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(repaired) as T;
  }
}

type ScanResult = {
  player_name: string;
  team: string | null;
  position: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  grade: string | null;
  grader: string | null;
  confidence: "high" | "medium" | "low";
  cardsight_card_id: string | null;
};

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data URL");
  const contentType = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

async function scanViaAIVision(imageUrl: string): Promise<ScanResult> {
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
              'Identify this baseball card. Return JSON: {"player_name": string, "team": string|null, "position": string|null, "year": number|null, "set_name": string|null, "card_number": string|null, "grade": string|null, "grader": string|null, "confidence": "high"|"medium"|"low"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null.',
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  const parsed = extractJson<Omit<ScanResult, "cardsight_card_id">>(text);
  return { ...parsed, cardsight_card_id: null };
}

// ---------- Photo scan: Cardsight REST identify, AI fallback ----------
export const scanCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { bytes, contentType } = dataUrlToBytes(data.imageDataUrl);

    // 1) Cardsight structured identify (returns canonical card_id + slab data).
    try {
      const { identifyCardRest } = await import("./cardsight.server");
      const { compressBytes } = await import("./tinypng.server");
      const compressed = await compressBytes(bytes, contentType);
      const ident = await identifyCardRest(compressed.bytes, compressed.contentType);
      if (ident?.player_name) {
        return enrichWithMlb(ident as ScanResult);
      }
    } catch (err) {
      console.error("Cardsight identify failed:", err);
    }

    // 2) Fallback: direct AI vision on the original data URL.
    const result = await scanViaAIVision(data.imageDataUrl);
    return enrichWithMlb(result);
  });

// If team/position are missing, look them up from the free MLB Stats API.
async function enrichWithMlb(result: ScanResult): Promise<ScanResult> {
  if (!result.player_name || (result.team && result.position)) return result;
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(result.player_name)}&sportIds=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return result;
    const body = await res.json();
    const people = (body.people ?? []) as Array<{
      fullName: string;
      primaryPosition?: { abbreviation?: string };
      currentTeam?: { name?: string };
      active?: boolean;
    }>;
    if (people.length === 0) return result;
    const pick = people.find((p) => p.active) ?? people[0];
    return {
      ...result,
      team: result.team ?? pick.currentTeam?.name ?? null,
      position: result.position ?? pick.primaryPosition?.abbreviation ?? null,
    };
  } catch {
    return result;
  }
}

// ---------- Value estimate + comparable sales ----------
// Uses Cardsight's structured /v1/pricing endpoint when we have a canonical
// card_id. Falls back to an AI estimate when comps are insufficient.
export const estimateCardValue = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        // Legacy descriptor fields (still used for the AI fallback).
        player_name: z.string().min(1),
        year: z.number().int().optional().nullable(),
        set_name: z.string().optional().nullable(),
        card_number: z.string().optional().nullable(),
        grade: z.string().optional().nullable(),
        grader: z.string().optional().nullable(),
        is_autograph: z.boolean().optional().nullable(),
        serial_number: z.string().optional().nullable(),
        // Canonical Cardsight identifiers (preferred).
        cardsight_card_id: z.string().uuid().optional().nullable(),
        cardsight_parallel_id: z.string().uuid().optional().nullable(),
        cardsight_grade_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
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
    let usedCardsight = false;
    let resolvedGradeId: string | null = data.cardsight_grade_id ?? null;

    if (data.cardsight_card_id) {
      try {
        const { fetchPricing, resolveGradeId, median, trimOutliersIQR } = await import(
          "./cardsight.server"
        );
        if (!resolvedGradeId && data.grader && data.grade) {
          resolvedGradeId = await resolveGradeId(data.grader, data.grade);
        }
        // If the card is graded but we couldn't match a grade_id, skip Cardsight —
        // we don't want to price a graded card against raw comps.
        if (data.grader && data.grade && !resolvedGradeId) {
          compsNote = `Couldn't match grade "${data.grader} ${data.grade}" in Cardsight — using AI estimate.`;
        } else {
          const slice = await fetchPricing(data.cardsight_card_id, {
            parallel_id: data.cardsight_parallel_id ?? null,
            grade_id: resolvedGradeId,
            period: "6m",
            limit: 200,
          });

        const auctions = slice.auctionSales
          .filter((r) => Number.isFinite(r.price) && r.price > 0)
          .sort((a, b) => {
            const ta = a.date ? new Date(a.date).getTime() : 0;
            const tb = b.date ? new Date(b.date).getTime() : 0;
            return tb - ta;
          });

        if (auctions.length >= 3) {
          const trimmed = trimOutliersIQR(auctions.map((r) => r.price));
          currentValue = median(trimmed);

          // 30-day vs prior-30-day delta on the same stream.
          const now = Date.now();
          const day = 24 * 60 * 60 * 1000;
          const recent: number[] = [];
          const prior: number[] = [];
          for (const r of auctions) {
            if (!r.date) continue;
            const t = new Date(r.date).getTime();
            if (!Number.isFinite(t)) continue;
            const age = now - t;
            if (age <= 30 * day) recent.push(r.price);
            else if (age <= 60 * day) prior.push(r.price);
          }
          if (recent.length >= 2 && prior.length >= 2) {
            const rMed = median(recent);
            const pMed = median(prior);
            if (pMed > 0) deltaPct = ((rMed - pMed) / pMed) * 100;
          }

          sales = auctions.slice(0, 25).map((r) => ({
            sold_at: r.date ?? null,
            grade: slice.gradeLabel,
            price: r.price,
            source: `Cardsight (${r.source})`,
            url: r.url ?? null,
          }));
          usedCardsight = true;
        } else {
          compsNote = `Only ${auctions.length} recent sold comp${auctions.length === 1 ? "" : "s"} — using AI estimate.`;
        }
        }
      } catch (err) {
        console.error("Cardsight pricing failed:", err);
        compsNote = err instanceof Error ? err.message : String(err);
      }
    } else {
      compsNote = "Card not yet linked to Cardsight — using AI estimate.";
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

    const prompt = `Give a realistic current secondary-market value estimate (USD) for this baseball card: "${descriptor}". Also give a plausible 30-day percent change and 6 monthly historical value data points ending today. Return JSON ONLY:
{
  "current_value": number,
  "value_delta_pct": number,
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

    const ai = extractJson<{
      current_value: number;
      value_delta_pct: number;
      history: Array<{ recorded_at: string; value: number }>;
    }>(text);

    return {
      current_value: usedCardsight ? currentValue : ai.current_value,
      value_delta_pct: usedCardsight ? deltaPct : ai.value_delta_pct,
      sales,
      history: ai.history,
      source: usedCardsight ? ("cardsight" as const) : ("ai" as const),
      note: compsNote,
    };
  });
