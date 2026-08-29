import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { APPROVED_CARD_SETS, setFromCardNumber, toApprovedCardSet } from "./card-sets";

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
  // Read off the card itself (front foil/border text or the back's printed
  // numbering). These are what keep two identical-looking parallels apart.
  parallel_hint?: string | null;
  serial_number?: string | null;
  is_rookie?: boolean | null;
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

// Front (and, when supplied, back) vision read. Passing both faces in the same
// request is what makes two near-identical cards read consistently: the printed
// card number / set line / serial on the back disambiguates parallels that look
// almost identical from the front. temperature 0 keeps repeat scans stable.
async function scanViaAIVision(imageUrl: string, backImageUrl?: string | null): Promise<ScanResult> {
  const content: unknown[] = [
    {
      type: "text",
      text:
        `Identify this baseball card. ${backImageUrl ? "The FIRST image is the front of the card, the SECOND image is the back. The back carries the printed card number, copyright year, set/brand line and serial numbering — trust the back's printed text over anything inferred from the front." : ""} Return JSON: {"player_name": string, "team": string|null, "position": string|null, "year": number|null, "set_name": string|null, "card_number": string|null, "grade": string|null, "grader": string|null, "parallel_hint": string|null, "serial_number": string|null, "is_rookie": boolean|null, "confidence": "high"|"medium"|"low"}. Leave any field null if unreadable. grader is PSA/BGS/SGC/CGC or null. parallel_hint is the parallel/refractor/color variation printed or clearly visible on the card (e.g. "Gold Refractor", "Blue /150") or null for a base card — read it from the card's own foil/border/text, never guess. serial_number is numbering like "12/50" if printed, else null. IMPORTANT: set_name must be one of this exact approved list or null: ${APPROVED_CARD_SETS.join(", ")}. Do NOT include parallel, refractor, insert, color, numbering, year, or autograph descriptors in set_name. Never invent or guess a set name. The printed card number prefix names the product: e.g. BSR/BSA/BST = Bowman Sterling, BB = Bowman's Best, BCP = Bowman Chrome, BDC/BDP = Bowman Draft, BP = Bowman. Use it to pick the specific set instead of the bare brand.`,
    },
    { type: "image_url", image_url: { url: imageUrl } },
  ];
  if (backImageUrl) content.push({ type: "image_url", image_url: { url: backImageUrl } });
  const text = await callAI({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a baseball card identification expert. Extract details from card photos and transcribe printed text exactly. Reply ONLY with a JSON object matching the requested schema — no prose.",
      },
      { role: "user", content },
    ],
  });
  const parsed = extractJson<Omit<ScanResult, "cardsight_card_id">>(text);
  if (parsed && typeof parsed.set_name === "string") {
    parsed.set_name = toApprovedCardSet(stripParallelFromSetName(parsed.set_name)) ?? null;
  }
  if (parsed) {
    parsed.set_name = refineSetFromCardNumber(parsed.set_name, parsed.card_number);
  }
  return { ...parsed, cardsight_card_id: null };
}

// A card number prefix like "BSR-40" names the product ("Bowman Sterling")
// while the front photo often only shows the bare brand logo ("Bowman"). When
// the prefix resolves to a more specific set inside the same brand, prefer it.
function refineSetFromCardNumber(
  setName: string | null | undefined,
  cardNumber: string | null | undefined,
): string | null {
  const current = setName ? String(setName) : null;
  const inferred = setFromCardNumber(cardNumber);
  if (!inferred) return current;
  if (!current) return inferred;
  const brand = (value: string) => value.toLowerCase().replace(/[^a-z ]/g, "").trim().split(" ")[0];
  if (brand(current) !== brand(inferred)) return current;
  return inferred.length > current.length ? inferred : current;
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
async function scanViaAIVisionLinked(imageDataUrl: string, backImageDataUrl?: string | null): Promise<ScanResult> {
  const result = await scanViaAIVision(imageDataUrl, backImageDataUrl);
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

// Vault.03 is baseball-only. Classify the photo before spending any paid
// identification call on it, and reject anything that isn't a baseball card.
type SportCheck = { is_card: boolean; sport: string | null; confidence: "high" | "medium" | "low" };

export class NotBaseballCardError extends Error {}

async function assertBaseballCard(imageDataUrl: string): Promise<void> {
  let parsed: SportCheck | null = null;
  try {
    const text = await callAI({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You classify photos of trading cards. Reply ONLY with a JSON object — no prose.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                'Look at this image. Return JSON: {"is_card": boolean, "sport": "baseball"|"football"|"basketball"|"hockey"|"soccer"|"pokemon"|"other"|null, "confidence": "high"|"medium"|"low"}. is_card is true only if the image shows a trading card (raw or graded slab). sport is the sport or category the card belongs to; use null if you cannot tell. Baseball includes MLB, MiLB, NPB (Japanese baseball), college, and vintage baseball cards.',
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    });
    parsed = extractJson<SportCheck>(text);
  } catch (err) {
    // Never block a legitimate upload because the classifier itself failed.
    console.error("Sport pre-check failed:", err);
    return;
  }
  if (!parsed) return;
  const sport = (parsed.sport ?? "").toLowerCase();
  if (parsed.is_card === false && parsed.confidence === "high") {
    throw new NotBaseballCardError("That photo doesn't look like a trading card. Vault.03 only accepts baseball cards.");
  }
  // Only reject on a confident non-baseball read; an unknown/low-confidence
  // sport falls through to identification.
  if (sport && sport !== "baseball" && parsed.confidence !== "low") {
    throw new NotBaseballCardError(
      `This looks like a ${sport} card. Vault.03 only accepts baseball cards.`,
    );
  }
}

// A scan result plus what produced it and (when the two independent reads
// disagree) the competing candidates, so the UI can show the disagreement and
// let the user pick the correct match instead of silently guessing.
type ScanCandidate = ScanResult & {
  source: "catalog" | "ai";
  source_label: string;
};
type ScanResponse = ScanResult & {
  source: "catalog" | "ai";
  disagreement: boolean;
  candidates: ScanCandidate[];
  back_read: boolean;
  back_corrections: string[];
};

function asCandidate(r: ScanResult, source: "catalog" | "ai"): ScanCandidate {
  return {
    ...r,
    source,
    source_label: source === "catalog" ? "Catalog match" : "AI photo read",
  };
}

// The back's printed text is the most reliable source for card #, year, set and
// serial numbering, so it overrides whatever the front produced. When an
// identity field changes, the catalog link established from the front no longer
// applies and is re-resolved against the corrected fields.
async function applyBackRead(
  result: ScanResult,
  back: BackScanResult | null,
): Promise<{ result: ScanResult; corrections: string[] }> {
  if (!back) return { result, corrections: [] };
  const next: ScanResult = { ...result };
  const corrections: string[] = [];
  let identityChanged = false;
  if (back.card_number && back.card_number !== next.card_number) {
    next.card_number = back.card_number;
    corrections.push("card #");
    identityChanged = true;
  }
  if (back.year && back.year !== next.year) {
    next.year = back.year;
    corrections.push("year");
    identityChanged = true;
  }
  if (back.set_name && back.set_name !== next.set_name) {
    next.set_name = back.set_name;
    corrections.push("set");
    identityChanged = true;
  }
  if (back.serial_number && back.serial_number !== next.serial_number) {
    next.serial_number = back.serial_number;
    corrections.push("serial");
  }
  if (back.is_rookie === true && next.is_rookie !== true) {
    next.is_rookie = true;
    corrections.push("rookie");
  }
  if (identityChanged) {
    next.cardsight_card_id = null;
    next.cardsight_parallel_id = null;
    try {
      const { searchCatalogCardByFields, getCatalogValuationLookup } = await import("./cardsight.server");
      const descriptor = [next.year, next.set_name, next.player_name, next.card_number ? `#${next.card_number}` : null]
        .filter(Boolean)
        .join(" ");
      if (descriptor) {
        const id = await searchCatalogCardByFields({
          player_name: next.player_name,
          year: next.year,
          set_name: next.set_name,
          card_number: next.card_number,
          descriptor,
        });
        if (id) {
          next.cardsight_card_id = id;
          const canonical = await getCatalogValuationLookup(id);
          if (canonical?.set_name) next.set_name = String(canonical.set_name);
          if (canonical?.card_number) next.card_number = String(canonical.card_number);
        }
      }
    } catch (err) {
      console.error("Catalog re-link after back scan failed:", err);
    }
  }
  // Reading the back confirms the printed identity fields, so a corroborated
  // read is no longer "uncertain".
  if (back.card_number && back.confidence !== "low") next.confidence = "high";
  return { result: next, corrections };
}

// ---------- Photo scan: Cardsight REST identify, AI fallback ----------
export const scanCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string; backImageDataUrl?: string | null }) =>
    z
      .object({
        imageDataUrl: z.string().startsWith("data:image/"),
        backImageDataUrl: z.string().startsWith("data:image/").nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ScanResponse> => {
    await assertBaseballCard(data.imageDataUrl);
    const { bytes, contentType } = dataUrlToBytes(data.imageDataUrl);
    const backUrl = data.backImageDataUrl ?? null;

    // The back read runs as part of the normal scan (not a secondary step) and
    // in parallel with the structured identify, so it costs no extra wall time.
    const backPromise: Promise<BackScanResult | null> = backUrl
      ? readCardBackDetails(backUrl).catch((err) => {
          console.error("Back-of-card read failed:", err);
          return null;
        })
      : Promise.resolve(null);

    // 1) Cardsight structured identify (returns canonical card_id + slab data).
    // Send the crop dialog's high-resolution encode as-is: small print (card
    // number, subset name, serial) is what identification depends on, and the
    // display-oriented compressor resizes to 640x896, which destroys it. Only
    // very large uploads get shrunk, purely to stay inside request limits.
    let ident: ScanResult | null = null;
    try {
      const { identifyCardRest } = await import("./cardsight.server");
      let identifyBytes = bytes;
      let identifyType = contentType;
      if (bytes.byteLength > 4_000_000) {
        const { compressBytes } = await import("./tinypng.server");
        const compressed = await compressBytes(bytes, contentType);
        identifyBytes = compressed.bytes;
        identifyType = compressed.contentType;
      }
      ident = (await identifyCardRest(identifyBytes, identifyType)) as ScanResult | null;

    } catch (err) {
      console.error("Cardsight identify failed:", err);
    }

    const back = await backPromise;

    const finish = async (
      r: ScanResult,
      source: "catalog" | "ai",
      extra?: { disagreement?: boolean; candidates?: ScanCandidate[] },
    ): Promise<ScanResponse> => {
      const { result, corrections } = await applyBackRead(r, back);
      return {
        ...result,
        source,
        disagreement: extra?.disagreement ?? false,
        candidates: extra?.candidates ?? [],
        back_read: back != null,
        back_corrections: corrections,
      };
    };

    if (ident?.player_name) {
      // A high-confidence structured match is trusted directly — the common,
      // cheap, fast path. Without a back photo there's nothing to corroborate
      // it with; with one, the printed back still gets the final word.
      if (ident.confidence === "high" && !back) {
        return finish(await enrichWithMlb(ident), "catalog");
      }
      // Medium/low confidence (or a back photo available): a wrong guess here
      // reads as "identification returned the wrong player/number" with nothing
      // to catch it, so corroborate with an independent vision read of both faces.
      const aiChecked = await scanViaAIVisionLinked(data.imageDataUrl, backUrl);
      if (ident.confidence === "high" || namesLikelyMatch(ident.player_name, aiChecked.player_name)) {
        const enriched = await enrichWithMlb(ident);
        // Keep the details only visible on the card itself (parallel wording,
        // serial numbering, rookie mark) from the vision read.
        return finish(
          {
            ...enriched,
            parallel_hint: enriched.parallel_hint ?? aiChecked.parallel_hint ?? null,
            serial_number: enriched.serial_number ?? aiChecked.serial_number ?? null,
            is_rookie: enriched.is_rookie ?? aiChecked.is_rookie ?? null,
          },
          "catalog",
        );
      }
      // The two independent reads disagree on the player — neither is
      // trustworthy alone. Surface both so the user resolves it explicitly.
      const catalogEnriched = await enrichWithMlb(ident);
      return finish({ ...aiChecked, confidence: "low" }, "ai", {
        disagreement: true,
        candidates: [asCandidate(aiChecked, "ai"), asCandidate(catalogEnriched, "catalog")],
      });
    }

    // 2) Fallback: direct AI vision (Cardsight identify failed outright).
    const fallback = await scanViaAIVisionLinked(data.imageDataUrl, backUrl);
    return finish(fallback, "ai");
  });


// ---------- Back-of-card scan ----------
// The back of a baseball card carries the printed card number, copyright year,
// set/brand line and serial numbering in plain text — the exact fields a front
// scan most often misreads. This returns only what it can actually read so the
// caller can fill gaps and correct the front read.
type BackScanResult = {
  player_name: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  serial_number: string | null;
  is_rookie: boolean | null;
  confidence: "high" | "medium" | "low";
};

export const scanCardBack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { imageDataUrl: string }) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }): Promise<BackScanResult> => readCardBackDetails(data.imageDataUrl));

async function readCardBackDetails(imageDataUrl: string): Promise<BackScanResult> {
  {
    const data = { imageDataUrl };

    const text = await callAI({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You read the BACK of baseball cards and transcribe printed text exactly. Reply ONLY with a JSON object — no prose. Never guess: use null for anything you cannot literally read.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Read the back of this baseball card. Return JSON: {"player_name": string|null, "year": number|null, "set_name": string|null, "card_number": string|null, "serial_number": string|null, "is_rookie": boolean|null, "confidence": "high"|"medium"|"low"}. card_number is the printed card number exactly as shown (without a leading #). year is the card's set year (use the copyright year if that is all that is printed). serial_number is hand- or machine-numbered text like "12/50" if present, else null. is_rookie true only if the back explicitly marks a rookie card. set_name must be one of this exact approved list or null: ${APPROVED_CARD_SETS.join(", ")}. Do NOT include parallel, refractor, insert, color, numbering or autograph descriptors in set_name.`,
            },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
    });
    const parsed = extractJson<BackScanResult>(text);
    if (!parsed) {
      return {
        player_name: null,
        year: null,
        set_name: null,
        card_number: null,
        serial_number: null,
        is_rookie: null,
        confidence: "low",
      };
    }
    const backCardNumber = parsed.card_number
      ? String(parsed.card_number).replace(/^#/, "").trim()
      : null;
    return {
      player_name: parsed.player_name ?? null,
      year: parsed.year != null ? Number(parsed.year) || null : null,
      set_name: refineSetFromCardNumber(
        parsed.set_name ? toApprovedCardSet(stripParallelFromSetName(String(parsed.set_name))) ?? null : null,
        backCardNumber,
      ),
      card_number: backCardNumber,
      serial_number: parsed.serial_number ? String(parsed.serial_number).trim() : null,
      is_rookie: typeof parsed.is_rookie === "boolean" ? parsed.is_rookie : null,
      confidence: parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
    };
  }
}


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
        // Bypass the 24h sold-comp cache and the 7-day lookup cooldown.
        force_refresh: z.boolean().optional().nullable(),
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
    // True only when a pricing source actually errored out (network failure,
    // rate limit, exhausted credits) — NOT when the sources simply returned no
    // matching comps. The UI uses this to decide between "Valuation temporarily
    // unavailable" and "No comps available".
    let pipelineError = false;
    // A source can answer successfully while returning no exact matches. If at
    // least one source answered, a later fallback error must not turn that
    // legitimate empty result into a temporary-outage message.
    let pricingSourceResponded = false;

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
      if (data.force_refresh) return false;
      if (!data.cardsight_lookup_failed_at) return false;

      const t = new Date(data.cardsight_lookup_failed_at).getTime();
      return Number.isFinite(t) && Date.now() - t < LOOKUP_RETRY_COOLDOWN_MS;
    })();

    // If we don't yet have a cardsight card id, resolve one via catalog search.
    const normalizeSource = (raw: string) => {
      const lower = String(raw ?? "").toLowerCase();
      if (lower.includes("130") || lower.includes("ebay")) return "eBay sold";
      return raw || "eBay sold";
    };

    // Resolve the saved parallel before either pricing source runs. eBay is the
    // primary pass, so doing this only inside cardsightPass meant its verifier
    // saw a selected parallel id but no parallel name and rejected the exact
    // parallel listings. Manage Comps resolved the name independently, which is
    // why the same rows appeared correct there.
    if (resolvedCardId && data.cardsight_parallel_id) {
      try {
        const { getParallelNameForCard } = await import("./cardsight.server");
        selectedParallelName = await getParallelNameForCard(resolvedCardId, data.cardsight_parallel_id);
      } catch (err) {
        console.error("Cardsight parallel-name lookup failed:", err);
      }
    }

    const cardsightPass = async () => {
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
    // CardSight filters its structured endpoint by id, but scraped sold listings
    // still need the human-readable parallel name for exact title verification.
    if (resolvedCardId && data.cardsight_parallel_id && !selectedParallelName) {
      try {
        const { getParallelNameForCard } = await import("./cardsight.server");
        selectedParallelName = await getParallelNameForCard(resolvedCardId, data.cardsight_parallel_id);
      } catch (err) {
        console.error("Cardsight parallel-name lookup failed:", err);
      }
    }


    const priceFromSlice = async (slice: Awaited<ReturnType<typeof import("./cardsight.server").fetchPricing>>) => {
      pricingSourceResponded = true;
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

      if (auctions.length >= 2) {
        // Two verified sold comps is the floor for a defensible median; a single
        // sale is shown as a comparable but never becomes the card's value.
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
        // A grade we can't resolve is no reason to skip the backstop entirely.
        // Price from raw comps instead and say the graded premium is missing.
        const gradeUnresolved = Boolean(data.grader && data.grade && !resolvedGradeId);
        if (gradeUnresolved) {
          compsNote = `Couldn't match grade "${data.grader} ${data.grade}" — value shown from ungraded comps.`;
        }
        {
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
        pipelineError = true;
        compsNote = err instanceof Error ? err.message : String(err);
      }

    }

    // Do not fan out into repeated catalog corrections and broad pricing
    // searches. One canonical pricing request is the entire CardSight pricing
    // budget for a saved card; if it has no verified sales, use the daily
    // eBay-sold fallback below instead.
    if (!usedCardsight && !compsNote) {
      compsNote = resolvedCardId
        ? "No verified sales for this catalog card."
        : "Couldn't match this card to the catalog.";
    }
    };

    // eBay sold data (via the 24h-cached 130point completed-sales index) is the
    // PRIMARY source: it is real completed sales, costs no CardSight calls, and
    // in practice has comps for cards CardSight's catalog can't price.
    const ebaySoldPass = async () => {
      if (usedCardsight || !data.card_id) return;
      try {
        const { selectValuationComps, scoreCompTitle } = await import("./cardsight.server");
        const {
          buildPt130SearchTiers,
          refreshPt130ForCard,
        } = await import("./pt130.server");

        const compLookup = {
          player_name: valuationLookup.player_name,
          year: valuationLookup.year,
          set_name: valuationLookup.set_name,
          card_number: valuationLookup.card_number,
          selected_parallel_name: selectedParallelName,
          is_autograph: valuationLookup.is_autograph,
          serial_number: data.serial_number,
          is_first_bowman: valuationLookup.is_first_bowman,
          grader: data.grader,
          grade: data.grade,
        };

        type CompRow = { title: string | null; price: number | string; sold_at: string | null; url: string | null; scraped_at?: string };
        const loadRows = async (): Promise<CompRow[]> => {
          const r = await context.supabase
            .from("pt130_comps")
            .select("title, price, sold_at, url, scraped_at")
            .eq("card_id", data.card_id as string)
            .order("sold_at", { ascending: false });
          if (r.error) throw r.error;
          const seen = new Set<string>();
          return (r.data ?? []).filter((row) => {
            const price = Number(row.price);
            if (!Number.isFinite(price) || price <= 0) return false;
            const key = [row.url, row.title, row.sold_at, price].map((v) => String(v ?? "")).join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }) as CompRow[];
        };

        let rows = await loadRows();
        const newestScrape = rows.reduce((latest, row) => {
          const time = new Date(row.scraped_at ?? 0).getTime();
          return Number.isFinite(time) && time > latest ? time : latest;
        }, 0);
        const cacheFresh =
          !data.force_refresh && newestScrape > 0 && Date.now() - newestScrape < 24 * 60 * 60 * 1000;

        const tiers = buildPt130SearchTiers({
          player_name: valuationLookup.player_name,
          year: valuationLookup.year,
          set_name: valuationLookup.set_name,
          card_number: valuationLookup.card_number,
          is_autograph: valuationLookup.is_autograph,
          selected_parallel_name: selectedParallelName,
          serial_number: data.serial_number,
          grader: data.grader,
          grade: data.grade,
        });
        const runSearch = async (descriptor: string, append: boolean) => {
          await refreshPt130ForCard(context.supabase as never, {
            card_id: data.card_id as string,
            user_id: context.userId,
            descriptor: [descriptor],
            card_number: valuationLookup.card_number,
            append,
          });
          rows = await loadRows();
        };
        const qualifiedCount = () =>
          rows.filter((row) => {
            const level = scoreCompTitle(row.title ?? "", compLookup).level;
            return level === "exact" || level === "strong";
          }).length;

        // Tier 1: exact product + card number. Only re-scraped when the cache is stale.
        if (!cacheFresh && tiers.primary) await runSearch(tiers.primary, false);
        // Tiers 2 and 3 run whenever the verified pool is thin — even on a fresh
        // cache, because a fresh cache full of unusable rows is still no comps.
        if (qualifiedCount() < 8 && tiers.brand) await runSearch(tiers.brand, true);
        if (qualifiedCount() < 5 && tiers.noNumber) await runSearch(tiers.noNumber, true);

        const selection = selectValuationComps(
          rows.map((row) => ({
            title: row.title ?? null,
            price: Number(row.price),
            sold_at: row.sold_at ?? null,
            url: row.url ?? null,
          })),
          compLookup,
        );

        if (selection.value != null && selection.comps.length >= 2) {
          sales = selection.comps.map((row) => ({
            sold_at: row.sold_at ?? null,
            grade: data.grader && data.grade ? `${data.grader} ${data.grade}` : null,
            price: Number(row.price),
            source: "eBay sold",
            url: row.url ?? null,
            title: row.title ?? null,
          }));
          currentValue = selection.value;
          usedCardsight = true;
          compsNote = selection.note;
        } else if (rows.length > 0) {
          compsNote =
            "Found sold listings but fewer than two matched this exact card — open Manage Comps to pick the right ones.";
        }
        pricingSourceResponded = true;

      } catch (err) {
        console.error("eBay sold pass failed:", err);
        pipelineError = true;
      }

    };

    // Real sold data first, CardSight catalog pricing only as a backstop.
    await ebaySoldPass();
    if (!usedCardsight) await cardsightPass();


    // No generic fallback median here: `sales` is only ever populated with
    // verified exact/strong comps, and anything less must never set a value.

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
        valuation_error: false,
        resolved_cardsight_card_id: resolvedCardId,
        resolved_cardsight_grade_id: resolvedGradeId,
      };

    }

    // No verified sold data means there is no defensible automatic value.
    // Keep the existing card value untouched (applyValuation treats zero as a
    // failed attempt) and let the user enter a manual value instead of showing
    // a confident but invented AI price.
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

    return {
      current_value: 0,
      value_delta_pct: 0,
      sales,
      history: [],
      source: "ai" as const,
      note: compsNote ?? `No verified sold comps found for ${descriptor}. Enter a value manually.`,
      valuation_error: pipelineError && !pricingSourceResponded,
      resolved_cardsight_card_id: resolvedCardId,
      resolved_cardsight_grade_id: resolvedGradeId,
    };
  });

