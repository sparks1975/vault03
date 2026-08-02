import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APPROVED_CARD_SETS, toApprovedCardSet } from "./card-sets";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.5-flash";

// A card that failed catalog resolution will very likely fail again. Skip
// re-running the multi-request resolution cascade until this cooldown
// elapses, so repeated triggers (auto-revalue, "Re-value all", Manage Comps)
// don't re-pay the full cost for a card that isn't in the catalog.
const LOOKUP_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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

function normalizeNameTokens(name: string | null | undefined): string[] {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1);
}

// True when the two names plausibly refer to the same person — every token in
// the shorter name appears in the longer one. Used to corroborate a
// low/medium-confidence Cardsight identify against an independent AI read
// rather than trusting either one alone.
function namesLikelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = normalizeNameTokens(a);
  const tb = normalizeNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.includes(t));
}

// AI vision identify + best-effort Cardsight catalog link, so pricing and
// parallels work off the AI's read too. Used both as the fallback when
// Cardsight identify fails outright, and to corroborate a low/medium
// confidence Cardsight identify.
async function scanViaAIVisionLinked(imageDataUrl: string): Promise<ScanResult> {
  const result = await scanViaAIVision(imageDataUrl);
  const enriched = await enrichWithMlb(result);
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
    let ident: ScanResult | null = null;
    try {
      const { identifyCardRest } = await import("./cardsight.server");
      const { compressBytes } = await import("./tinypng.server");
      const compressed = await compressBytes(bytes, contentType);
      ident = (await identifyCardRest(compressed.bytes, compressed.contentType)) as ScanResult | null;
    } catch (err) {
      console.error("Cardsight identify failed:", err);
    }

    if (ident?.player_name) {
      // A high-confidence structured match is trusted directly — the common,
      // cheap, fast path.
      if (ident.confidence === "high") {
        return enrichWithMlb(ident);
      }
      // Medium/low confidence: a wrong guess here reads as "identification
      // returned the wrong player/team/number" with nothing to catch it, so
      // corroborate with an independent AI vision read before trusting it.
      const aiChecked = await scanViaAIVisionLinked(data.imageDataUrl);
      if (namesLikelyMatch(ident.player_name, aiChecked.player_name)) {
        return enrichWithMlb(ident);
      }
      // The two independent reads disagree on the player — neither is
      // trustworthy alone. Prefer the AI read (already catalog-linked) but
      // make sure the confidence stays low so the UI's existing "verify the
      // details" prompt reflects the real uncertainty here.
      return { ...aiChecked, confidence: "low" };
    }

    // 2) Fallback: direct AI vision (Cardsight identify failed outright).
    return scanViaAIVisionLinked(data.imageDataUrl);
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
    // The name search is fuzzy and common surnames match multiple people.
    // Blindly picking the first active result (or just the first result)
    // silently attaches the wrong team/position when there's more than one
    // plausible person — prefer an exact full-name match, then require the
    // remaining candidate pool to be unambiguous before auto-filling
    // anything. Leaving team/position null is safer than guessing wrong,
    // since a blank field prompts the user to check it and a wrong-looking-
    // plausible one doesn't.
    const wanted = result.player_name.trim().toLowerCase();
    const exact = people.filter((p) => p.fullName?.trim().toLowerCase() === wanted);
    const pool = exact.length > 0 ? exact : people;
    const activeInPool = pool.filter((p) => p.active);
    const pick = activeInPool.length === 1 ? activeInPool[0] : pool.length === 1 ? pool[0] : null;
    if (!pick) return result;
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
        // When the catalog resolution cascade last failed for this card, so we
        // can skip re-running it on every trigger while it's still recent.
        cardsight_lookup_failed_at: z.string().optional().nullable(),
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

    // If a resolution attempt failed recently, don't re-run the cascade yet —
    // go straight to the eBay/AI fallback below instead.
    const lookupFailedRecently = (() => {
      if (!data.cardsight_lookup_failed_at) return false;
      const t = new Date(data.cardsight_lookup_failed_at).getTime();
      return Number.isFinite(t) && Date.now() - t < LOOKUP_RETRY_COOLDOWN_MS;
    })();

    // If we don't yet have a cardsight card id, resolve one via catalog search.
    if (!resolvedCardId && !lookupFailedRecently) {
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
      if (!resolvedCardId && data.card_id) {
        try {
          await context.supabase
            .from("cards")
            .update({ cardsight_lookup_failed_at: new Date().toISOString() } as never)
            .eq("id", data.card_id);
        } catch (err) {
          console.error("Failed to persist cardsight_lookup_failed_at:", err);
        }
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
    // A card id that was already saved on the card was verified when it was
    // first resolved. Re-verifying it on every re-value cost extra billed calls
    // (catalog detail + a correction search + a parallel-name lookup) without
    // changing the answer. Only canonicalize a *freshly* resolved id.
    if (resolvedCardId && !data.cardsight_card_id) {
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
          // Identity conflict on a brand-new match: don't price it, and don't
          // spend more calls hunting. The eBay-sold fallback handles it.
          resolvedCardId = null;
        }
      } catch (err) {
        console.error("Cardsight valuation lookup failed:", err);
      }
    }
    // Parallel filtering is done server-side by CardSight via parallel_id, so we
    // no longer spend calls resolving the parallel's display name.
    void selectedParallelName;


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

      if (auctions.length >= 1) {
        // Any verified sold comp is real market data — far better than an AI
        // guess. Only trim outliers once there are enough points for IQR to be
        // meaningful.
        const prices = auctions.map((r) => r.price);
        currentValue = median(auctions.length >= 4 ? trimOutliersIQR(prices) : prices);


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
        compsNote = "No verified sold comps for this catalog card — checking eBay sold.";
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
          let slice = await fetchPricing(resolvedCardId, {
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
          const submittedPlayerTokens = usefulTokens(data.player_name);
          const pricedPlayer = normalizeLookupText(slice.cardIdentity?.name);
          const pricedWrongPlayer = submittedPlayerTokens.length > 0 &&
            !submittedPlayerTokens.every((token) => pricedPlayer.includes(token));
          if (pricedWrongPlayer) {
            // The saved UUID came from an incorrect scan. The pricing response
            // itself tells us the player, so detect this without a routine
            // catalog-detail call. Only stale cards pay the one-time correction
            // lookup and second pricing request.
            const { findCatalogCard } = await import("./cardsight.server");
            const corrected = await findCatalogCard({
              player_name: data.player_name,
              year: data.year,
              set_name: data.set_name,
              card_number: data.card_number,
              is_autograph: data.is_autograph,
              is_first_bowman: data.is_first_bowman,
            });
            if (!corrected?.id || corrected.id === resolvedCardId) {
              resolvedCardId = null;
              compsNote = `The saved catalog match was for a different player — checking eBay sold.`;
            } else {
              resolvedCardId = corrected.id;
              resolvedGradeId = null;
              slice = await fetchPricing(resolvedCardId, {
                parallel_id: null,
                grade_id: null,
                player_name: data.player_name,
                year: data.year,
                set_name: data.set_name,
                card_number: data.card_number,
                grader: data.grader,
                grade: data.grade,
                is_autograph: data.is_autograph,
                is_first_bowman: data.is_first_bowman,
                serial_number: data.serial_number,
                selected_parallel_name: null,
                period: "5y",
              });
            }
          }
          if (!resolvedCardId) {
            slice = { auctionSales: [], askListings: [], gradeLabel: null, cardIdentity: null };
          }
          await priceFromSlice(slice);
        }
      } catch (err) {
        console.error("Cardsight pricing failed:", err);
        compsNote = err instanceof Error ? err.message : String(err);
      }
    }

    // Do not fan out into repeated catalog corrections and broad pricing
    // searches. One canonical pricing request is the entire CardSight pricing
    // budget for a saved card; if it has no verified sales, use the daily
    // eBay-sold fallback below instead.
    if (!usedCardsight && !compsNote) {
      compsNote = resolvedCardId
        ? "No verified sales for this catalog card — checking eBay sold."
        : "Couldn't match this card to the catalog — checking eBay sold.";
    }

    // Fallback to eBay sold results. Reuse a cache younger than 24 hours; when
    // the cache is absent/stale, refresh this one card on demand. That avoids a
    // permanent no-comps result between nightly jobs while bounding scraping to
    // one successful, specific query per card per day.
    if (!usedCardsight && data.card_id) {
      try {
        const { verifyCompTitle } = await import("./cardsight.server");
        let { data: cachedRows, error } = await context.supabase
          .from("pt130_comps")
          .select("title, price, sold_at, url, scraped_at")
          .eq("card_id", data.card_id)
          .order("sold_at", { ascending: false });
        if (error) throw error;

        const newestScrape = (cachedRows ?? []).reduce((latest, row) => {
          const time = new Date(row.scraped_at).getTime();
          return Number.isFinite(time) && time > latest ? time : latest;
        }, 0);
        const cacheFresh = newestScrape > 0 && Date.now() - newestScrape < 24 * 60 * 60 * 1000;
        if (!cacheFresh) {
          const { buildPt130Descriptors, refreshPt130ForCard } = await import("./pt130.server");
          const descriptors = buildPt130Descriptors({
            player_name: valuationLookup.player_name,
            year: valuationLookup.year,
            set_name: valuationLookup.set_name,
            card_number: valuationLookup.card_number,
            is_autograph: valuationLookup.is_autograph,
            selected_parallel_name: selectedParallelName,
            grader: data.grader,
            grade: data.grade,
          });
          if (descriptors.length > 0) {
            await refreshPt130ForCard(context.supabase as never, {
              card_id: data.card_id,
              user_id: context.userId,
              descriptor: descriptors,
            });
            const refreshed = await context.supabase
              .from("pt130_comps")
              .select("title, price, sold_at, url, scraped_at")
              .eq("card_id", data.card_id)
              .order("sold_at", { ascending: false });
            if (refreshed.error) throw refreshed.error;
            cachedRows = refreshed.data;
          }
        }

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
