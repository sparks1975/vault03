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
  // Walk to find matching close, respecting strings.
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
};

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string; ext: string } {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data URL");
  const contentType = m[1];
  const base64 = m[2];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = contentType.split("/")[1]?.split("+")[0] || "jpg";
  return { bytes, contentType, ext };
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
              "Identify this baseball card. Return JSON: {\"player_name\": string, \"team\": string|null, \"position\": string|null, \"year\": number|null, \"set_name\": string|null, \"card_number\": string|null, \"grade\": string|null, \"grader\": string|null, \"confidence\": \"high\"|\"medium\"|\"low\"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return extractJson<ScanResult>(text);
}

// ---------- Photo scan: Cardsight identify_card, AI fallback ----------
export const scanCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Upload the cropped photo to storage so Cardsight can fetch a public URL.
    let signedUrl: string | null = null;
    try {
      const src = dataUrlToBytes(data.imageDataUrl);
      const { compressBytes } = await import("./tinypng.server");
      const { bytes, contentType } = await compressBytes(src.bytes, src.contentType);
      const ext = contentType.split("/")[1]?.split("+")[0] || src.ext;
      const path = `${userId}/scans/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("card-photos")
        .upload(path, bytes, { contentType, upsert: false });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from("card-photos")
        .createSignedUrl(path, 300);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("No signed URL");
      signedUrl = signed.signedUrl;
    } catch (err) {
      console.error("Storage upload for identify_card failed:", err);
    }

    // 2) Ask Cardsight to identify the card from the URL.
    if (signedUrl) {
      try {
        const { identifyCardFromImageUrl } = await import("./cardsight.server");
        const { text, error } = await identifyCardFromImageUrl(signedUrl);
        console.log("Cardsight identify_card text:", text?.slice(0, 500), "error:", error);
        const looksUnidentified =
          !text?.trim() ||
          /unable to identify|could not identify|no match|not.*identif|no card detected|error/i.test(text);
        if (!error && !looksUnidentified) {
          // Convert Cardsight's human-readable response into our JSON schema.
          const structured = await callAI({
            model: MODEL,
            messages: [
              {
                role: "system",
                content:
                  "You convert baseball card identification notes into strict JSON. Reply ONLY with a JSON object — no prose.",
              },
              {
                role: "user",
                content: `Cardsight identify_card response:\n\n${text}\n\nReturn JSON: {"player_name": string, "team": string|null, "position": string|null, "year": number|null, "set_name": string|null, "card_number": string|null, "grade": string|null, "grader": string|null, "confidence": "high"|"medium"|"low"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null.`,
              },
            ],
          });
          try {
            const parsed = extractJson<ScanResult>(structured);
            if (parsed.player_name && parsed.player_name.trim()) {
              return await enrichWithMlb(parsed);
            }
            console.warn("Cardsight structured result had no player_name, falling back to AI vision");
          } catch (err) {
            console.error("Failed to structure Cardsight identify_card text:", err);
          }
        } else if (error) {
          console.error("Cardsight identify_card error:", error);
        }
      } catch (err) {
        console.error("Cardsight identify_card call failed:", err);
      }
    }

    // 3) Fallback: direct AI vision on the original data URL.
    const result = await scanViaAIVision(data.imageDataUrl);
    return await enrichWithMlb(result);
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
    // Prefer active player; fall back to first match.
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


// ---------- Value estimate + comparable sales (AI estimate) ----------
export const estimateCardValue = createServerFn({ method: "POST" })
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
        serial_number: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
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

    // 1) Cardsight for real SOLD comps (search_pricing over MCP).
    let sales: Array<{
      sold_at: string | null;
      grade: string | null;
      price: number;
      source: string;
      url: string | null;
    }> = [];
    let compsAverage = 0;
    let compsNote: string | null = null;
    try {
      const { fetchCardsightSoldComps } = await import("./cardsight.server");
      const soldRes = await fetchCardsightSoldComps(data, { limit: 25, period: "6m" });
      if (soldRes.comps.length > 0) {
        sales = soldRes.comps.map((c) => ({
          sold_at: c.soldAt,
          grade: c.grade,
          price: c.price,
          source: `Cardsight (${c.source} sold)`,
          url: c.url,
        }));
        const prices = sales.map((s) => s.price).sort((a, b) => a - b);
        compsMedian = prices[Math.floor(prices.length / 2)];
      } else {
        compsNote = soldRes.error ?? null;
      }
    } catch (err) {
      console.error("Cardsight lookup failed:", err);
      compsNote = err instanceof Error ? err.message : String(err);
    }

    // 2) AI for narrative value + history (and as value fallback if Cardsight is empty).
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
      current_value: compsMedian > 0 ? compsMedian : ai.current_value,
      value_delta_pct: ai.value_delta_pct,
      sales,
      history: ai.history,
      source: compsMedian > 0 ? ("cardsight" as const) : ("ai" as const),
      note: compsNote,
    };
  });


