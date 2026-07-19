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
    const enriched = await enrichWithMlb(result);
    // Try to link a Cardsight card id via free-text search so pricing + parallels work.
    try {
      const { searchCatalogCardByFields } = await import("./cardsight.server");
      const desc = [enriched.year, enriched.set_name, enriched.player_name, enriched.card_number ? `#${enriched.card_number}` : null]
        .filter(Boolean)
        .join(" ");
      if (desc) {
        const id = await searchCatalogCardByFields({
          player_name: enriched.player_name,
          year: enriched.year,
          set_name: enriched.set_name,
          card_number: enriched.card_number,
          descriptor: desc,
        });
        if (id) enriched.cardsight_card_id = id;
      }
    } catch (err) {
      console.error("Cardsight search (post-scan) failed:", err);
    }
    return enriched;
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
  .middleware([requireSupabaseAuth])
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
        // Optional card_id enables merging cached 130point comps into the pool.
        card_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
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
    let resolvedCardId: string | null = data.cardsight_card_id ?? null;

    // If we don't yet have a cardsight card id, resolve one via catalog search.
    if (!resolvedCardId) {
      try {
        const { searchCatalogCardByFields } = await import("./cardsight.server");
        const descriptorForSearch = [
          data.year,
          data.set_name,
          data.player_name,
          data.card_number ? `#${data.card_number}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        resolvedCardId = await searchCatalogCardByFields({
          player_name: data.player_name,
          year: data.year,
          set_name: data.set_name,
          card_number: data.card_number,
          descriptor: descriptorForSearch,
          is_autograph: data.is_autograph,
        });
      } catch (err) {
        console.error("Cardsight search failed:", err);
      }
    }

    const priceFromSlice = async (slice: Awaited<ReturnType<typeof import("./cardsight.server").fetchPricing>>) => {
      const { median, trimOutliersIQR } = await import("./cardsight.server");
      const auctions = slice.auctionSales
        .filter((r) => Number.isFinite(r.price) && r.price > 0)
        .sort((a, b) => {
          const ta = a.date ? new Date(a.date).getTime() : 0;
          const tb = b.date ? new Date(b.date).getTime() : 0;
          return tb - ta;
        });

      if (auctions.length > 0) {
        sales = auctions.slice(0, 25).map((r) => {
          const typeLabel = r.listing_type === "fixed" ? "BIN" : r.listing_type === "auction" ? "Auction" : null;
          return {
            sold_at: r.date ?? null,
            grade: slice.gradeLabel,
            price: r.price,
            source: `Cardsight (${r.source}${typeLabel ? ` · ${typeLabel}` : ""})`,
            url: r.url ?? null,
          };
        });
      }

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

        usedCardsight = true;
        compsNote = null;
      } else {
        compsNote = `Only ${auctions.length} recent sold comp${auctions.length === 1 ? "" : "s"} — using AI estimate.`;
      }
    };

    if (resolvedCardId) {
      try {
        const { fetchPricing, resolveGradeId } = await import(
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
          const slice = await fetchPricing(resolvedCardId, {
            parallel_id: data.cardsight_parallel_id ?? null,
            grade_id: resolvedGradeId,
            player_name: data.player_name,
            year: data.year,
            card_number: data.card_number,
            grader: data.grader,
            grade: data.grade,
            is_autograph: data.is_autograph,
            serial_number: data.serial_number,
            period: "6m",
          });
          await priceFromSlice(slice);
        }
      } catch (err) {
        console.error("Cardsight pricing failed:", err);
        compsNote = err instanceof Error ? err.message : String(err);
      }
    }

    // Existing rows may have an older/wrong catalog ID saved from prior loose
    // matching. If exact structured pricing returns too few sold comps, resolve
    // the catalog card again from the editable fields and retry before using the
    // broader pricing-search fallback.
    if (!usedCardsight && resolvedCardId && !(data.grader && data.grade && !resolvedGradeId)) {
      try {
        const { fetchPricing, searchCatalogCardByFields } = await import("./cardsight.server");
        const descriptorForRetry = [
          data.year,
          data.set_name,
          data.player_name,
          data.card_number ? `#${data.card_number}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const retryCardId = await searchCatalogCardByFields({
          player_name: data.player_name,
          year: data.year,
          set_name: data.set_name,
          card_number: data.card_number,
          descriptor: descriptorForRetry,
          is_autograph: data.is_autograph,
        });
        if (retryCardId && retryCardId !== resolvedCardId) {
          const retrySlice = await fetchPricing(retryCardId, {
            parallel_id: data.cardsight_parallel_id ?? null,
            grade_id: resolvedGradeId,
            player_name: data.player_name,
            year: data.year,
            card_number: data.card_number,
            grader: data.grader,
            grade: data.grade,
            is_autograph: data.is_autograph,
            serial_number: data.serial_number,
            period: "6m",
          });
          await priceFromSlice(retrySlice);
          if (usedCardsight) resolvedCardId = retryCardId;
        }
      } catch (err) {
        console.error("Cardsight pricing retry failed:", err);
      }
    }

    if (!usedCardsight) {
      try {
        const { searchPricingComps } = await import("./cardsight.server");
        const searchSlice = await searchPricingComps(
          {
            player_name: data.player_name,
            year: data.year,
            set_name: data.set_name,
            card_number: data.card_number,
            is_autograph: data.is_autograph,
            serial_number: data.serial_number,
            grader: data.grader,
            grade: data.grade,
          },
          { period: "6m", limit: 100 },
        );
        await priceFromSlice(searchSlice);
        if (!usedCardsight && !compsNote) {
          compsNote = resolvedCardId
            ? "Cardsight returned too few comps for this exact catalog card — using pricing search fallback."
            : "Couldn't match this card to a catalog ID, and pricing search found too few comps — using AI estimate.";
        }
      } catch (err) {
        console.error("Cardsight pricing search failed:", err);
        if (!compsNote) compsNote = err instanceof Error ? err.message : String(err);
      }
    }

    // -------- Merge cached 130point sold comps into the valuation pool --------
    // Runs whenever the caller provided a card_id so we can load the per-card
    // cache and (if stale) refresh it from 130point via Firecrawl.
    if (data.card_id) {
      const cardId = data.card_id;
      const userId = context.userId;
      const supabase = context.supabase;
      const nowMs = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const sixMonthsMs = 180 * dayMs;

      const loadCache = async () => {
        const { data: rows, error } = await supabase
          .from("pt130_comps")
          .select("sold_at, price, title, url, listing_type, scraped_at")
          .eq("card_id", cardId)
          .order("scraped_at", { ascending: false });
        if (error) throw error;
        return rows ?? [];
      };

      try {
        let cached = await loadCache();
        const latestScrape = cached[0]?.scraped_at
          ? new Date(cached[0].scraped_at as string).getTime()
          : 0;
        const stale = !latestScrape || nowMs - latestScrape > dayMs;
        if (stale) {
          try {
            const { buildPt130Descriptor, refreshPt130ForCard } = await import(
              "./pt130.server"
            );
            const descriptor = buildPt130Descriptor({
              year: data.year,
              set_name: data.set_name,
              player_name: data.player_name,
              card_number: data.card_number,
              is_autograph: data.is_autograph,
              grader: data.grader,
              grade: data.grade,
            });
            if (descriptor) {
              await refreshPt130ForCard(supabase as never, {
                card_id: cardId,
                user_id: userId,
                descriptor,
              });
              cached = await loadCache();
            }
          } catch (err) {
            console.error("pt130 live refresh failed:", err);
          }
        }

        // Grade/auto filter on titles so we don't mix graded and raw comps.
        const gradedRe = /\b(psa|bgs|sgc|cgc)\b/i;
        const autoRe = /\b(auto(graph)?|signed|signature)\b/i;
        const isGradedCard = Boolean(data.grader && data.grade);
        const graderLower = (data.grader ?? "").toLowerCase();
        const gradeLower = String(data.grade ?? "").toLowerCase();

        const pt130Sales = (cached ?? [])
          .filter((c) => {
            if (!c.sold_at) return false;
            const t = new Date(c.sold_at as string).getTime();
            if (!Number.isFinite(t) || nowMs - t > sixMonthsMs) return false;
            const title = String(c.title ?? "").toLowerCase();
            if (isGradedCard) {
              if (!title.includes(graderLower)) return false;
              if (!title.includes(gradeLower)) return false;
            } else {
              if (gradedRe.test(title)) return false;
            }
            if (!data.is_autograph && autoRe.test(title)) return false;
            const price = Number(c.price);
            return Number.isFinite(price) && price > 0;
          })
          .map((c) => {
            const lt = (c.listing_type as string | null) ?? null;
            const typeLabel =
              lt === "fixed" ? "BIN" : lt === "auction" ? "Auction" : lt === "best_offer" ? "Best Offer" : null;
            return {
              sold_at: c.sold_at as string,
              grade: null as string | null,
              price: Number(c.price),
              source: `130point${typeLabel ? ` · ${typeLabel}` : ""}`,
              url: (c.url as string | null) ?? null,
            };
          });

        if (pt130Sales.length > 0) {
          // Combined pool: existing sales (cardsight) + pt130.
          const combined = [...sales, ...pt130Sales].sort((a, b) => {
            const ta = a.sold_at ? new Date(a.sold_at).getTime() : 0;
            const tb = b.sold_at ? new Date(b.sold_at).getTime() : 0;
            return tb - ta;
          });

          if (combined.length >= 3) {
            const { median, trimOutliersIQR } = await import("./cardsight.server");
            const trimmed = trimOutliersIQR(combined.map((r) => r.price));
            currentValue = median(trimmed);
            // 30-day vs prior-30 delta on the combined stream.
            const recent: number[] = [];
            const prior: number[] = [];
            for (const r of combined) {
              if (!r.sold_at) continue;
              const t = new Date(r.sold_at).getTime();
              if (!Number.isFinite(t)) continue;
              const age = nowMs - t;
              if (age <= 30 * dayMs) recent.push(r.price);
              else if (age <= 60 * dayMs) prior.push(r.price);
            }
            if (recent.length >= 2 && prior.length >= 2) {
              const rMed = median(recent);
              const pMed = median(prior);
              if (pMed > 0) deltaPct = ((rMed - pMed) / pMed) * 100;
            }
            sales = combined.slice(0, 25);
            usedCardsight = true;
            compsNote = null;
          }
        }
      } catch (err) {
        console.error("pt130 merge failed:", err);
      }
    }



    const fallbackHistory = (baseValue: number) => {
      const base = Number.isFinite(baseValue) && baseValue > 0 ? baseValue : 0;
      const now = new Date();
      return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now);
        d.setMonth(now.getMonth() - (5 - i));
        return { recorded_at: d.toISOString(), value: base };
      });
    };

    if (usedCardsight) {
      return {
        current_value: currentValue,
        value_delta_pct: deltaPct,
        sales,
        history: fallbackHistory(currentValue),
        source: "cardsight" as const,
        note: compsNote,
        resolved_cardsight_card_id: resolvedCardId,
        resolved_cardsight_grade_id: resolvedGradeId,
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
      current_value: ai.current_value,
      value_delta_pct: ai.value_delta_pct,
      sales,
      history: ai.history,
      source: "ai" as const,
      note: compsNote,
      resolved_cardsight_card_id: resolvedCardId,
      resolved_cardsight_grade_id: resolvedGradeId,
    };
  });
