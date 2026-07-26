import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APPROVED_CARD_SETS, toApprovedCardSet } from "./card-sets";

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
  cardsight_parallel_id?: string | null;
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
          "You are a sports card identification expert (baseball, football, basketball, hockey, soccer). Extract details from card photos. Reply ONLY with a JSON object matching the requested schema — no prose.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Identify this sports card. Return JSON: {"player_name": string, "team": string|null, "position": string|null, "year": number|null, "set_name": string|null, "card_number": string|null, "grade": string|null, "grader": string|null, "confidence": "high"|"medium"|"low"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null. IMPORTANT: set_name must be one of this exact approved list or null: ${APPROVED_CARD_SETS.join(", ")}. Do NOT include parallel, refractor, insert, color, numbering, year, or autograph descriptors in set_name. Never invent or guess a set name.`,
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  const parsed = extractJson<Omit<ScanResult, "cardsight_card_id">>(text);
  if (parsed && typeof parsed.set_name === "string") {
    parsed.set_name = toApprovedCardSet(stripParallelFromSetName(parsed.set_name)) ?? null;
  }
  return { ...parsed, cardsight_card_id: null };
}

// Remove parallel/refractor/insert descriptors an AI model may append to a set
// name. Set names should only reflect the actual product; parallels live on a
// separate field.
const AI_PARALLEL_TOKENS = /\b(refractor|refractors|parallel|prizm(?!s? draft| basketball| baseball| football)|xfractor|superfractor|atomic|wave|shimmer|mojo|holo(graphic)?|rainbow|sparkle|foilboard|die[- ]?cut|cracked ice|pulsar|scope|hyper|lazer|shock|sapphire|ruby|emerald|onyx|aqua|teal|magenta|neon|camo|numbered|serial|auto|autograph|patch|relic|memorabilia|jersey|insert|inserts|short print|sp|ssp|variation|image variation|photo variation|\/\d+|silver|gold|black|red|blue|green|orange|purple|pink|yellow|bronze|copper|platinum)\b/gi;
function stripParallelFromSetName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(AI_PARALLEL_TOKENS, " ");
  s = s.replace(/\s{2,}/g, " ").replace(/[\s\-–—]+$/g, "").replace(/^[\s\-–—]+/g, "").trim();
  if (!s || s.length < 3) return null;
  return s;
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
      const { getCatalogValuationLookup, searchCatalogCardByFields } = await import("./cardsight.server");
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
        if (id) {
          enriched.cardsight_card_id = id;
          const canonical = await getCatalogValuationLookup(id);
          if (canonical?.set_name) enriched.set_name = String(canonical.set_name);
          if (canonical?.year != null) enriched.year = Number(canonical.year) || enriched.year;
          if (canonical?.card_number) enriched.card_number = String(canonical.card_number);
          if (canonical?.player_name) enriched.player_name = String(canonical.player_name);
        }
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
        is_first_bowman: z.boolean().optional().nullable(),
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
      title: string | null;
    }> = [];
    let currentValue = 0;
    let deltaPct = 0;
    let compsNote: string | null = null;
    let usedCardsight = false;
    let resolvedGradeId: string | null = data.cardsight_grade_id ?? null;
    let resolvedCardId: string | null = data.cardsight_card_id ?? null;
    let selectedParallelName: string | null = null;
    let valuationLookup: {
      player_name: string | null;
      year: string | number | null | undefined;
      set_name: string | null | undefined;
      card_number: string | null | undefined;
      is_autograph: boolean | null | undefined;
      is_first_bowman: boolean | null | undefined;
    } = {
      player_name: data.player_name,
      year: data.year,
      set_name: data.set_name,
      card_number: data.card_number,
      is_autograph: data.is_autograph,
      is_first_bowman: data.is_first_bowman,
    };
    const submittedLookup = { ...valuationLookup };

    const normalizeLookupText = (value: string | number | null | undefined) =>
      String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const usefulTokens = (value: string | number | null | undefined) =>
      normalizeLookupText(value)
        .split(" ")
        .filter((t) => t.length > 1 && !["the", "card", "cards", "base", "set", "series", "autograph", "autographs"].includes(t));
    const identityMatchesSubmitted = (candidate: Partial<typeof valuationLookup>) => {
      const submittedPlayer = usefulTokens(submittedLookup.player_name);
      const candidatePlayer = normalizeLookupText(candidate.player_name);
      if (submittedPlayer.length > 0 && !submittedPlayer.every((t) => candidatePlayer.includes(t))) return false;
      const submittedSetTokens = usefulTokens(submittedLookup.set_name);
      const candidateSet = normalizeLookupText(candidate.set_name);
      if (submittedSetTokens.length >= 2) {
        const overlap = submittedSetTokens.filter((t) => candidateSet.includes(t)).length;
        if (overlap < Math.min(2, submittedSetTokens.length)) return false;
      }
      return true;
    };

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

    const normalizeSource = (raw: string) => {
      const lower = String(raw ?? "").toLowerCase();
      if (lower.includes("130") || lower.includes("ebay")) return "eBay sold";
      return raw || "eBay sold";
    };

    const medianValueFromSales = async (rows: typeof sales) => {
      const prices = rows.map((r) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0);
      if (prices.length === 0) return null;
      const { median } = await import("./cardsight.server");
      return median(prices);
    };

    // When we have a canonical catalog ID, use the catalog's own year/set/card
    // number for matching. Editable/AI-extracted fields can be stale or wrong;
    // using them to filter title comps creates false "no sales" results.
    if (resolvedCardId) {
      try {
        const { getCatalogValuationLookup } = await import("./cardsight.server");
        const catalogLookup = await getCatalogValuationLookup(resolvedCardId);
        if (catalogLookup && identityMatchesSubmitted(catalogLookup)) {
          valuationLookup = {
            player_name: catalogLookup.player_name ?? valuationLookup.player_name,
            year: catalogLookup.year == null ? valuationLookup.year : Number(catalogLookup.year) || valuationLookup.year,
            set_name: catalogLookup.set_name ?? valuationLookup.set_name,
            card_number: catalogLookup.card_number ?? valuationLookup.card_number,
            is_autograph: data.is_autograph === true ? true : catalogLookup.is_autograph ?? valuationLookup.is_autograph,
            is_first_bowman: data.is_first_bowman,
          };
        } else if (catalogLookup) {
          const { searchCatalogCardByFields } = await import("./cardsight.server");
          const descriptorForCorrection = [
            submittedLookup.year,
            submittedLookup.set_name,
            submittedLookup.player_name,
            submittedLookup.card_number ? `#${submittedLookup.card_number}` : null,
          ].filter(Boolean).join(" ");
          const correctedId = await searchCatalogCardByFields({
            ...submittedLookup,
            descriptor: descriptorForCorrection,
          });
          resolvedCardId = correctedId && correctedId !== resolvedCardId ? correctedId : null;
        }
      } catch (err) {
        console.error("Cardsight valuation lookup failed:", err);
      }
      if (resolvedCardId && data.cardsight_parallel_id) {
        try {
          const { getParallelNameForCard } = await import("./cardsight.server");
          selectedParallelName = await getParallelNameForCard(resolvedCardId, data.cardsight_parallel_id);
        } catch (err) {
          console.error("Cardsight parallel lookup failed:", err);
        }
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
        sales = auctions.slice(0, 200).map((r) => {
          const typeLabel = r.listing_type === "fixed" ? "BIN" : r.listing_type === "auction" ? "Auction" : null;
          return {
            sold_at: r.date ?? null,
            grade: slice.gradeLabel,
            price: r.price,
            source: `${normalizeSource(r.source)}${typeLabel ? ` · ${typeLabel}` : ""}`,
            url: r.url ?? null,
            title: r.title ?? null,
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
            player_name: valuationLookup.player_name,
            year: valuationLookup.year,
            set_name: valuationLookup.set_name,
            card_number: valuationLookup.card_number,
            grader: data.grader,
            grade: data.grade,
            is_autograph: valuationLookup.is_autograph,
            is_first_bowman: valuationLookup.is_first_bowman,
            serial_number: data.serial_number,
            selected_parallel_name: selectedParallelName,
            period: "5y",
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
          valuationLookup.year,
          valuationLookup.set_name,
          valuationLookup.player_name,
          valuationLookup.card_number ? `#${valuationLookup.card_number}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const retryCardId = await searchCatalogCardByFields({
          player_name: valuationLookup.player_name,
          year: valuationLookup.year,
          set_name: valuationLookup.set_name,
          card_number: valuationLookup.card_number,
          descriptor: descriptorForRetry,
          is_autograph: valuationLookup.is_autograph,
          is_first_bowman: valuationLookup.is_first_bowman,
        });
        if (retryCardId && retryCardId !== resolvedCardId) {
          const retrySlice = await fetchPricing(retryCardId, {
            parallel_id: data.cardsight_parallel_id ?? null,
            grade_id: resolvedGradeId,
            player_name: valuationLookup.player_name,
            year: valuationLookup.year,
            set_name: valuationLookup.set_name,
            card_number: valuationLookup.card_number,
            grader: data.grader,
            grade: data.grade,
            is_autograph: valuationLookup.is_autograph,
            is_first_bowman: valuationLookup.is_first_bowman,
            serial_number: data.serial_number,
            selected_parallel_name: selectedParallelName,
            period: "5y",
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
            player_name: valuationLookup.player_name,
            year: valuationLookup.year,
            set_name: valuationLookup.set_name,
            card_number: valuationLookup.card_number,
            is_autograph: valuationLookup.is_autograph,
            is_first_bowman: valuationLookup.is_first_bowman,
            serial_number: data.serial_number,
            selected_parallel_name: selectedParallelName,
            grader: data.grader,
            grade: data.grade,
          },
          { period: "5y", limit: 100 },
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

    // Fast fallback: use already-cached eBay sold comps when the structured
    // pricing API returns too few/no records. This does NOT run the live scrape,
    // so it keeps valuation fast while still showing comps we already have.
    if (!usedCardsight && data.card_id) {
      try {
        const { verifyCompTitle } = await import("./cardsight.server");
        const { data: cachedRows, error } = await context.supabase
          .from("pt130_comps")
          .select("title, price, sold_at, url")
          .eq("card_id", data.card_id)
          .order("sold_at", { ascending: false });
        if (error) throw error;

        const cachedSales = (cachedRows ?? [])
          .filter((row) => {
            const price = Number(row.price);
            if (!Number.isFinite(price) || price <= 0) return false;
            const title = row.title ?? "";
            return verifyCompTitle(title, {
              player_name: valuationLookup.player_name,
              year: valuationLookup.year,
              set_name: valuationLookup.set_name,
              card_number: valuationLookup.card_number,
              selected_parallel_name: selectedParallelName,
              is_autograph: valuationLookup.is_autograph,
              serial_number: data.serial_number,
              is_first_bowman: valuationLookup.is_first_bowman,
            }).verified;
          })
          .map((row) => ({
            sold_at: row.sold_at ?? null,
            grade: data.grader && data.grade ? `${data.grader} ${data.grade}` : null,
            price: Number(row.price),
            source: "eBay sold",
            url: row.url ?? null,
            title: row.title ?? null,
          }));

        if (cachedSales.length > 0) {
          sales = cachedSales;
          const saleMedian = await medianValueFromSales(sales);
          if (saleMedian != null) {
            currentValue = saleMedian;
            usedCardsight = true;
            compsNote = null;
          }
        }
      } catch (err) {
        console.error("Cached eBay sold fallback failed:", err);
      }
    }

    // Live 130point scrape remains disabled — it was too slow during valuation.
    // The fallback above only reads rows that are already cached in the database.


    if (!usedCardsight) {
      const saleMedian = await medianValueFromSales(sales);
      if (saleMedian != null) {
        currentValue = saleMedian;
        usedCardsight = true;
        compsNote = null;
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
      const saleMedian = await medianValueFromSales(sales);
      if (saleMedian != null) currentValue = saleMedian;
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

    // Guarantee a non-zero value: retry once with a stronger prompt if AI returned 0.
    let aiValue = Number(ai.current_value) || 0;
    if (aiValue <= 0) {
      try {
        const retry = await callAI({
          model: MODEL,
          messages: [
            { role: "system", content: "You are a sports card market analyst. Always return a positive USD estimate even with limited data — never zero. Reply ONLY with JSON." },
            { role: "user", content: `Estimate current secondary-market value in USD for: "${descriptor}". Return JSON: {"current_value": number}. current_value must be > 0.` },
          ],
        });
        const parsed = extractJson<{ current_value: number }>(retry);
        aiValue = Number(parsed.current_value) || 0;
      } catch (err) {
        console.error("AI value retry failed:", err);
      }
    }

    return {
      current_value: aiValue,
      value_delta_pct: ai.value_delta_pct,
      sales,
      history: ai.history?.length ? ai.history : fallbackHistory(aiValue),
      source: "ai" as const,
      note: compsNote ?? (sales.length === 0 ? "No sold comps found — value is an AI market estimate." : compsNote),
      resolved_cardsight_card_id: resolvedCardId,
      resolved_cardsight_grade_id: resolvedGradeId,
    };
  });
