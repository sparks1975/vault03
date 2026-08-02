// Server-only Cardsight REST client. Do not import from client-reachable modules
// at top level. See https://cardsight.ai/documentation/api-reference.
import { createClient } from "@supabase/supabase-js";
import { toApprovedCardSet } from "./card-sets";
import type { Database } from "@/integrations/supabase/types";

const REST_BASE = "https://api.cardsight.ai";

// The app deploys to an edge/Workers-style runtime where module-level state
// (below) isn't guaranteed to survive across requests/isolates. Back the GET
// cache with Supabase so a cold isolate doesn't re-bill a lookup a warm one
// just made. Uses the service role directly (this table has no RLS policies,
// isn't user data, and isn't reachable from any client-exposed function) so
// callers don't need to thread a request-scoped Supabase client through every
// Cardsight helper.
let cacheDb: ReturnType<typeof createClient<Database>> | null | undefined;
function getCacheDb(): ReturnType<typeof createClient<Database>> | null {
  if (cacheDb !== undefined) return cacheDb;
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cacheDb = url && serviceRole
    ? createClient<Database>(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;
  return cacheDb;
}

function apiKey(): string {
  const k = process.env.CARDSIGHT_API_KEY;
  if (!k) throw new Error("CARDSIGHT_API_KEY is not configured");
  return k;
}

// Global throttle: Cardsight allows 6 req/sec. We space calls ≥200ms apart
// (5 rps) with a shared promise chain so concurrent server-fn invocations
// (e.g. revaluing multiple cards) don't burst past the limit.
const MIN_INTERVAL_MS = 220;
let lastCallAt = 0;
let gate: Promise<void> = Promise.resolve();
function reserveSlot(): Promise<void> {
  const next = gate.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  gate = next.catch(() => {});
  return next;
}

async function csFetchUncached<T>(path: string, init?: RequestInit): Promise<T> {
  let lastBody = "";
  let lastStatus = 0;
  // A failed provider request can still count against the account quota. One
  // retry is enough to recover a transient 429/5xx without turning every
  // logical lookup into six billed calls.
  for (let attempt = 0; attempt < 2; attempt++) {
    await reserveSlot();
    const res = await fetch(`${REST_BASE}${path}`, {
      ...init,
      headers: {
        "X-API-Key": apiKey(),
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.ok) return (await res.json()) as T;
    lastStatus = res.status;
    lastBody = await res.text().catch(() => "");
    if (res.status !== 429 && res.status < 500) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = retryAfter > 0 ? retryAfter * 1000 : 800;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  throw new Error(`Cardsight ${path} ${lastStatus}: ${lastBody.slice(0, 200)}`);
}

// GET responses are cached and de-duplicated. A single valuation (and a
// "re-value all" pass) repeats the same catalog/pricing GETs many times —
// resolve, verify, correct, retry, relaxed re-filter — which multiplied billed
// API calls without changing the answer. Same URL within the TTL = one call.
//
// Two layers: an in-memory Map as a same-isolate fast path (no network round
// trip), and the `cardsight_cache` Supabase table as the layer correctness
// actually depends on, since isolates are not guaranteed to be warm.
const GET_CACHE_TTL_MS = 15 * 60 * 1000;
const GET_CACHE_MAX = 500;
const getCache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function readDurableCache<T>(path: string): Promise<T | undefined> {
  const db = getCacheDb();
  if (!db) return undefined;
  try {
    const { data } = await db
      .from("cardsight_cache")
      .select("payload, expires_at")
      .eq("cache_key", path)
      .maybeSingle();
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return undefined;
    return data.payload as T;
  } catch (err) {
    console.error("cardsight_cache read failed:", err);
    return undefined;
  }
}

async function writeDurableCache(path: string, value: unknown): Promise<void> {
  const db = getCacheDb();
  if (!db) return;
  try {
    await db.from("cardsight_cache").upsert(
      { cache_key: path, payload: value as never, expires_at: new Date(Date.now() + GET_CACHE_TTL_MS).toISOString() },
      { onConflict: "cache_key" },
    );
  } catch (err) {
    console.error("cardsight_cache write failed:", err);
  }
}

async function csFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return csFetchUncached<T>(path, init);

  const hit = getCache.get(path);
  if (hit && Date.now() - hit.at < GET_CACHE_TTL_MS) return hit.value as T;
  if (hit) getCache.delete(path);

  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const durableHit = await readDurableCache<T>(path);
    if (durableHit !== undefined) return durableHit;
    const value = await csFetchUncached<T>(path, init);
    await writeDurableCache(path, value);
    return value;
  })()
    .then((value) => {
      if (getCache.size >= GET_CACHE_MAX) {
        const oldest = getCache.keys().next().value;
        if (oldest) getCache.delete(oldest);
      }
      getCache.set(path, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflight.delete(path);
    });
  inflight.set(path, promise);
  return promise;
}

// ---------- Types (subset of the OpenAPI schemas we actually use) ----------
export type PricingRecord = {
  title?: string | null;
  price: number;
  date?: string | null;
  source: string;
  listing_type?: "auction" | "fixed" | null;
  url?: string | null;
  parallel_id?: string | null;
  parallel_name?: string | null;
};

type RawSection = { count: number; records: PricingRecord[] };
type GradeGroup = { grade_value: string; grade_id: string; count: number; records: PricingRecord[] };
type CompanyGroup = { company_name: string; company_id: string; grades: GradeGroup[] };
type PricingResponse = {
  card: { card_id: string; name: string };
  query?: Record<string, unknown>;
  raw: RawSection;
  graded: CompanyGroup[];
  meta?: Record<string, unknown>;
  messages?: Array<{ code?: string; message?: string }>;
};

type IdentifyResponse = {
  success: boolean;
  requestId?: string;
  processingTime?: number;
  detections?: Array<{
    confidence: "High" | "Medium" | "Low";
    card: {
      id?: string;
      segmentId?: string;
      releaseId?: string;
      setId?: string;
      name?: string;
      number?: string;
      year?: string;
      manufacturer?: string;
      releaseName?: string;
      setName?: string;
      parallel?: {
        id?: string;
        name?: string;
        numberedTo?: number;
      };
    };
    grading?: {
      confidence?: "High" | "Medium" | "Low";
      company?: { id?: string; name?: string };
    };
  }>;
};

// Set names in Cardsight's `setName` field frequently contain parallel/refractor
// descriptors (e.g. "Refractor", "Pink Refractor", "Gold /50"). Those belong on
// the parallel, not the set. Return `releaseName` alone (the true product like
// "2020 Topps Chrome"), appending `setName` only when it's a real sub-set (e.g.
// "Update", "Draft Picks") rather than a parallel/insert descriptor.
const PARALLEL_KEYWORDS = /\b(refractor|refractors|parallel|prizm|prizms|xfractor|superfractor|atomic|wave|shimmer|mojo|holo|holographic|rainbow|sparkle|foil|foilboard|die[- ]?cut|cracked ice|pulsar|scope|hyper|lazer|shock|silver|gold|black|red|blue|green|orange|purple|pink|yellow|bronze|copper|platinum|sapphire|ruby|emerald|onyx|aqua|teal|magenta|neon|camo|mini|mojo|numbered|serial|\/\d+|auto|autograph|patch|relic|memorabilia|jersey|insert|inserts|short print|sp\b|ssp\b|variation|image variation|photo variation)\b/i;
function sanitizeSetName(releaseName?: string | null, setName?: string | null): string | null {
  const release = (releaseName ?? "").trim();
  const set = (setName ?? "").trim();
  const cleanRelease = release.replace(/^\s*(19|20)\d{2}\s+/, "");
  const cleanSet = PARALLEL_KEYWORDS.test(set) || /^(base|base set)$/i.test(set) ? null : set;
  const approved = toApprovedCardSet(cleanRelease, cleanSet);
  if (approved) return approved;
  if (!release && !set) return null;
  if (!release) return null;
  if (!set) return null;
  if (!cleanSet) return null;
  // Avoid duplicating a set descriptor already present in the release name.
  if (release.toLowerCase().includes(set.toLowerCase())) return release;
  return null;
}

// ---------- Identify ----------
export type IdentifyResult = {
  cardsight_card_id: string | null;
  cardsight_parallel_id: string | null;
  player_name: string | null;
  team: string | null;
  position: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  grade: string | null;
  grader: string | null;
  confidence: "high" | "medium" | "low";
};

/**
 * Identify a card via Cardsight's REST API.
 *
 * Per Cardsight's official documentation, we call the segment-specific
 * endpoint `/v1/identify/card/baseball` — Vault.03 is a baseball-focused
 * collection, so we always know the segment. Cardsight's docs state the
 * segment-specific route is more accurate and faster than the mixed
 * auto-detect route, which must infer segment before identification.
 *
 * Request shape follows Cardsight docs exactly:
 *   - POST https://api.cardsight.ai/v1/identify/card/baseball
 *   - Header: X-Api-Key
 *   - Body: multipart/form-data with field name `image`
 *
 * Docs: https://cardsight.ai/documentation/api-reference
 */
export async function identifyCardRest(
  bytes: Uint8Array,
  contentType: string,
): Promise<IdentifyResult | null> {
  const ct = /^image\/(jpeg|png|webp|heif|heic)$/i.test(contentType) ? contentType : "image/jpeg";
  // Copy into a fresh ArrayBuffer to satisfy Blob's BlobPart typing.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const blob = new Blob([buf], { type: ct });

  const form = new FormData();
  form.append("image", blob, "card.jpg");

  const res = await fetch(`${REST_BASE}/v1/identify/card/baseball`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey(), Accept: "application/json" },
    body: form,
  });
  if (!res.ok) {
    console.error("Cardsight identify failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const j = (await res.json()) as IdentifyResponse;
  const det = j.detections?.[0];
  if (!det || !det.card) return null;
  const c = det.card;
  // Identification is exactly one billed call. The identify response already
  // carries the canonical card id, name, year, release/set and number, so we do
  // NOT make a second catalog-detail request here.
  return {
    cardsight_card_id: c.id ?? null,
    cardsight_parallel_id: c.parallel?.id ?? null,
    player_name: c.name ?? null,
    team: null,
    position: null,
    year: c.year ? Number(c.year) || null : null,
    set_name: sanitizeSetName(c.releaseName, c.setName),
    card_number: c.number ?? null,

    grade: null,
    grader: det.grading?.company?.name ?? null,
    confidence: (det.confidence?.toLowerCase() as "high" | "medium" | "low") ?? "medium",
  };
}

// ---------- Free-text catalog search (resolve descriptor → cardsight card id) ----------
type SearchResult = {
  type: "card" | "set" | "release" | "parallel";
  id: string;
  name: string;
  relevance: number;
  year?: string;
  setName?: string;
  releaseName?: string;
  manufacturerName?: string;
};

type CatalogCard = {
  releaseId: string;
  setId: string;
  id: string;
  number?: string | null;
  name: string;
  description?: string | null;
  setName?: string | null;
  releaseName?: string | null;
  releaseYear?: string | null;
  variationOf?: string | null;
  parallelCount?: number;
  parallels?: Array<{ id: string; name: string; numberedTo?: number | null }>;
};

export type SetCandidate = {
  card_id: string;
  set_name: string;
  release_name: string | null;
  subset_name: string | null;
  player_name: string | null;
  year: string | null;
  card_number: string | null;
  relevance: number;
};

type CardLookup = {
  card_id?: string | null;
  player_name?: string | null;
  year?: string | number | null;
  set_name?: string | null;
  card_number?: string | null;
  descriptor?: string | null;
  is_autograph?: boolean | null;
  is_first_bowman?: boolean | null;
};

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serialSearchTerm(serialNumber: string | null | undefined): string | null {
  const raw = compact(serialNumber);
  if (!raw) return null;
  const denom = raw.match(/\/\s*(\d+)/)?.[1];
  return denom ? `/${denom}` : raw;
}

function selectedParallelTitleMatches(title: string, parallelName: string | null | undefined): boolean {
  const rawName = compact(parallelName);
  if (!rawName) return false;
  const rawTitle = compact(title);
  const denom = rawName.match(/\/\s*(\d+)/)?.[1] ?? null;
  if (denom && !new RegExp(`/\\s*${escapeRegex(denom)}($|[^0-9])`, "i").test(rawTitle)) return false;

  const normalizedName = normalizeText(rawName.replace(/\/\s*\d+/g, " "));
  const allTokens = normalizedName.split(" ").filter((t) => t.length > 1);
  const generic = new Set(["parallel", "chrome", "prizm", "foil", "card", "cards"]);
  const specificTokens = allTokens.filter((t) => !generic.has(t));
  const titleNorm = normalizeText(rawTitle);
  return specificTokens.length > 0
    ? specificTokens.every((t) => titleNorm.includes(t))
    : Boolean(denom);
}

function hasUnselectedParallelModifier(title: string, selectedParallelName: string | null | undefined): boolean {
  const titleNorm = normalizeText(title);
  const selectedNorm = normalizeText(selectedParallelName);
  const modifiers = [
    "atomic", "black", "blue", "bronze", "camo", "clear cut", "cracked ice", "die cut", "foilfractor",
    "gold", "green", "mojo", "negative", "orange", "pink", "platinum", "purple", "rainbow", "red",
    "rose gold", "sepia", "shimmer", "silver", "superfractor", "red hot", "x fractor", "yellow", "aqua",
    "teal", "wave", "nebula", "scope", "hyper", "lava", "dragon", "tiger", "zebra", "snake",
    "choice", "holo", "holographic", "ssp", "printing plate",
  ];
  return modifiers.some((modifier) => titleNorm.includes(modifier) && !selectedNorm.includes(modifier));
}

function normalizeCardNumber(value: string | number | null | undefined): string {
  return compact(value)
    .replace(/^#\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * True when the marketplace title states the wanted card number, either as an
 * explicit "#112-SP" style token or as a delimited token elsewhere in the title
 * ("112 SP", "no. 112-SP"). Used as mandatory evidence — sellers who omit the
 * number can't be verified as the same card.
 */
function titleMentionsCardNumber(title: string, wantedNumber: string): boolean {
  if (!wantedNumber) return true;
  if (extractMarketplaceCardNumbers(title).includes(wantedNumber)) return true;
  // Flexible scan: allow any separator between digit/letter groups so a wanted
  // number of "112sp" matches "112-SP", "112 SP" and "#112SP", while staying
  // token-bounded so it never matches inside another number (e.g. 1120).
  const groups = wantedNumber.match(/\d+|[a-z]+/gi) ?? [wantedNumber];
  const pattern = groups.map((g) => escapeRegex(g)).join("[^a-z0-9]?");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(title);
}

function titleHasPhrase(titleNorm: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return new RegExp(`(^| )${escapeRegex(normalizedPhrase)}($| )`, "i").test(titleNorm);
}

const SET_TITLE_ALIASES: Record<string, string[]> = {
  "Topps Black and White": ["topps black and white", "topps black white", "topps b w", "topps bw"],
  "Topps Complete/Factory Sets": ["topps complete", "topps factory"],
  "Topps Allen & Ginter": ["topps allen ginter", "allen ginter", "allen and ginter"],
  "Contenders / Contenders Draft Picks": ["contenders", "contenders draft picks"],
  "BBM 1st Version": ["bbm 1st version", "bbm first version", "bbm 1st", "bbm first"],
  "BBM 2nd Version": ["bbm 2nd version", "bbm second version", "bbm 2nd", "bbm second"],
  "BBM Fusion": ["bbm fusion"],
  "BBM Rookie Edition": ["bbm rookie edition", "bbm rookie"],
  "BBM Draft": ["bbm draft"],
  "BBM Team Sets": ["bbm team set", "bbm team sets"],
  "BBM Premium / Genesis": ["bbm premium", "bbm genesis"],
  "BBM Glory": ["bbm glory"],
  "BBM Infinity": ["bbm infinity"],
  "BBM Icons": ["bbm icons"],
  "BBM Crown": ["bbm crown"],
  "BBM Special / Theme Sets": ["bbm special", "bbm theme"],
  "Epoch NPB": ["epoch npb"],
  "Epoch NPB Luxury Collection": ["epoch npb luxury", "epoch luxury collection", "epoch luxury"],
  "Epoch Team Premier Edition": ["epoch team premier edition", "epoch premier"],
  "Epoch Stars & Legends": ["epoch stars legends", "epoch stars and legends"],
  "Epoch Rookie Sets": ["epoch rookie set", "epoch rookie sets"],
  "Epoch OB Club / Holographica": ["epoch ob club", "epoch holographica"],
  "Epoch Team Sets": ["epoch team set", "epoch team sets"],
  "Topps NPB Chrome": ["topps npb chrome"],
  "Topps NPB Stadium Club": ["topps npb stadium club"],
  "Topps NPB Finest": ["topps npb finest"],
  "Topps Bowman NPB": ["topps bowman npb", "bowman npb"],
  "Topps NPB 206": ["topps npb 206", "npb 206"],
};

function titleMatchesKnownSetAlias(titleNorm: string, setName: string): boolean {
  return (SET_TITLE_ALIASES[setName] ?? []).some((phrase) => titleHasPhrase(titleNorm, phrase));
}

function hasConflictingKnownSetAlias(titleNorm: string, setName: string | null | undefined): boolean {
  const approved = toApprovedCardSet(setName) ?? compact(setName);
  if (!approved) return false;
  return Object.entries(SET_TITLE_ALIASES).some(([otherSet, phrases]) => {
    if (otherSet === approved) return false;
    const sameBrand = normalizeText(otherSet).split(" ")[0] === normalizeText(approved).split(" ")[0];
    return sameBrand && phrases.some((phrase) => titleHasPhrase(titleNorm, phrase));
  });
}

function strictSetTitleMatches(title: string, setName: string | null | undefined): boolean {
  const approved = toApprovedCardSet(setName) ?? compact(setName);
  if (!approved) return true;

  const titleNorm = normalizeText(title);
  if (titleMatchesKnownSetAlias(titleNorm, approved)) return true;

  const setNorm = normalizeText(approved);
  if (titleHasPhrase(titleNorm, setNorm)) return true;

  const brandTokens = ["topps", "bowman", "panini", "donruss", "bbm", "epoch", "calbee", "prizm", "select", "fleer", "ultra"];
  const common = new Set(["base", "card", "cards", "set", "sets", "series", "and", "the", "collection", "edition"]);
  const setTokens = setNorm.split(" ").filter(Boolean);
  const brands = setTokens.filter((token) => brandTokens.includes(token));
  if (brands.length > 0 && !brands.some((brand) => titleHasPhrase(titleNorm, brand))) return false;

  const discriminators = setTokens.filter((token) => !brandTokens.includes(token) && !common.has(token));
  if (discriminators.length === 0) return brands.length === 0 || brands.some((brand) => titleHasPhrase(titleNorm, brand));

  const matched = discriminators.filter((token) => titleHasPhrase(titleNorm, token)).length;
  if (discriminators.length <= 2) return matched === discriminators.length;
  return matched >= Math.max(2, discriminators.length - 1);
}

export function verifyCompTitle(
  title: string | null | undefined,
  lookup: {
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    is_autograph?: boolean | null;
    serial_number?: string | null;
    is_first_bowman?: boolean | null;
    selected_parallel_name?: string | null;
    hasSelectedParallel?: boolean;
    relaxedSetMatch?: boolean;
  },
): { verified: boolean; reasons: string[] } {
  const rawTitle = compact(title);
  const reasons: string[] = [];
  if (!rawTitle) return { verified: false, reasons: ["missing title"] };

  const titleNorm = normalizeText(rawTitle);
  const playerTokens = normalizeText(lookup.player_name)
    .split(" ")
    .filter((t) => t.length > 1);
  if (playerTokens.length > 0 && !playerTokens.every((t) => titleHasPhrase(titleNorm, t))) {
    reasons.push("player name mismatch");
  }

  const year = compact(lookup.year);
  if (year && !new RegExp(`(^|[^0-9])${escapeRegex(year)}($|[^0-9])`).test(rawTitle)) {
    reasons.push("year mismatch");
  }

  const wantedNumber = normalizeCardNumber(lookup.card_number);
  let explicitNumbers: string[] = [];
  if (wantedNumber) {
    explicitNumbers = extractMarketplaceCardNumbers(rawTitle);
    // An explicit, conflicting card number is strong evidence of a different
    // card — reject that. A title that never states a number at all is common
    // on real eBay listings and isn't evidence either way, so it no longer
    // rejects the comp by itself; the other discriminators below still have
    // to pass (player, year, set, autograph, serial, variant).
    if (explicitNumbers.length > 0 && !titleMentionsCardNumber(rawTitle, wantedNumber)) {
      const label = compact(lookup.card_number).replace(/^#\s*/, "");
      reasons.push(`card number #${label} mismatch`);
    }
  }

  if (!strictSetTitleMatches(rawTitle, lookup.set_name)) {
    const hasExactCardNumber = wantedNumber && explicitNumbers.includes(wantedNumber);
    if (!lookup.relaxedSetMatch || !hasExactCardNumber || hasConflictingKnownSetAlias(titleNorm, lookup.set_name)) {
      reasons.push("set mismatch");
    }
  }

  const isAutoTitle = AUTO_RE.test(rawTitle);
  if (lookup.is_autograph && !isAutoTitle) reasons.push("missing autograph marker");
  if (!lookup.is_autograph && isAutoTitle) reasons.push("autograph mismatch");

  const serial = serialSearchTerm(lookup.serial_number);
  if (serial && !rawTitle.toLowerCase().includes(serial.toLowerCase())) reasons.push("serial mismatch");

  // Remove the exact card-number token before looking for variant words. A
  // suffix such as 112-SP identifies the card itself; treating that SP as an
  // unrelated short-print modifier rejects the exact listing we just matched.
  const variantTitle = wantedNumber
    ? rawTitle.replace(
        new RegExp(
          `(^|[^a-z0-9])${(wantedNumber.match(/\d+|[a-z]+/gi) ?? [wantedNumber]).map((g) => escapeRegex(g)).join("[^a-z0-9]?")}([^a-z0-9]|$)`,
          "ig",
        ),
        " ",
      )
    : rawTitle;
  // Some catalog card numbers encode the variation itself (112-SP/SSP). In
  // that case seller phrases such as "image variation" and "short print" are
  // confirming the exact card, not evidence of a different parallel.
  const identityAwareVariantTitle = /(?:sp|ssp)$/i.test(wantedNumber)
    ? variantTitle.replace(/\b(image|photo)\s+variations?\b|\bshort\s*prints?\b|\bss?p\b/gi, " ")
    : variantTitle;
  if (isVariantTitle(identityAwareVariantTitle, {
    hasSelectedParallel: lookup.hasSelectedParallel,
    selectedParallelName: lookup.selected_parallel_name,
    set_name: lookup.set_name,
    is_autograph: lookup.is_autograph,
    serial_number: lookup.serial_number,
    is_first_bowman: lookup.is_first_bowman,
  })) {
    reasons.push(isNonSingleCardListing(rawTitle) ? "sealed/lot/non-single listing" : "parallel or variation mismatch");
  }

  return { verified: reasons.length === 0, reasons };
}

export function extractMarketplaceCardNumbers(title: string): string[] {
  const values = new Set<string>();
  const patterns = [
    /#\s*([A-Za-z0-9][A-Za-z0-9.-]{0,14})\b/g,
    /\b(?:no\.?|card\s*(?:no\.?|number|#))\s*#?\s*([A-Za-z0-9][A-Za-z0-9.-]{0,14})\b/gi,
    /\b([A-Z]{1,5}-[A-Z0-9]{1,8})\b/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(title)) !== null) {
      const normalized = normalizeCardNumber(match[1]);
      if (normalized && !/^\d{4}$/.test(normalized)) values.add(normalized);
    }
  }
  return [...values];
}

function pricingRecordMatches(
  record: PricingRecord,
  lookup: {
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    is_autograph?: boolean | null;
    serial_number?: string | null;
    grader?: string | null;
    grade?: string | null;
    is_first_bowman?: boolean | null;
    selected_parallel_name?: string | null;
    relaxedSetMatch?: boolean;
  },
): boolean {
  if (!Number.isFinite(record.price) || record.price <= 0) return false;
  return verifyCompTitle(record.title, lookup).verified;
}

// Shared parallel/variant regexes used by both the structured and pt130 paths.
// Any word or phrase here in a marketplace title indicates the record is NOT a
// plain base card — reject when the caller hasn't opted into that parallel.
// Explicit parallel keyword list (kept for legacy hits). The regexes below
// catch open-ended families ("<anything> refractor", "<color> wave", numbered
// parallels, printing plates, 1/1s, image variations) so we don't have to
// enumerate every new parallel Topps/Panini/Bowman invents.
const PARALLEL_COLOR_RE = /\b(atomic|black|blue|bronze|camo|clear cut|cracked ice|die[- ]?cut|foilfractor|gold|green|mojo|negative|orange|pink|platinum|prism|prizm|purple|rainbow|red|rose gold|sepia|shimmer|silver|superfractor|refractor|red hot|x-?fractor|yellow|aqua|teal|wave|nebula|scope|hyper|lava|dragon|tiger|zebra|snake|choice|holo|holographic|ssp|sp|printing plate|lunar|seismic|cosmic|galactic|sapphire|ruby|emerald|onyx|ice|velocity|genesis|disco|kaleidoscope|stained glass|independence|father'?s day|mother'?s day|memorial day|independence day|fireworks|checkerboard|magenta|clear|acetate|shortprint|short print|variation|image variation|photo variation|sp variation|ssp variation|1\s*of\s*1|1\/1)\b/i;
// Catches any "<word> fractor" / "<word> refractor" not covered above.
const REFRACTOR_FAMILY_RE = /\b[a-z]*fractor\b/i;
// "Wave" family: prizmatic, mojo wave, blue wave, etc.
const WAVE_FAMILY_RE = /\b[a-z]+\s+wave\b/i;
const FIRST_BOWMAN_RE = /\b(1st\s+bowman|first\s+bowman)\b/i;
const SERIAL_RE = /(^|[^\w])(#?\s*\d+\s*\/\s*\d+|\/\s*\d{1,4})(?=$|[^\w])/i;
const AUTO_RE = /\b(auto|autograph|autographs|signed|signature|signatures)\b/i;
// Reject non-single-card listings: breaks, sealed wax, cases, packs, lots, sets.
// This stays separate from card-identity matching so we can block obvious junk
// without making real single-card comps disappear.
const NON_SINGLE_CARD_RE = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|factory\s*sealed|sealed\s*(wax|box|case|pack|packs|product)|unopened|hobby\s*(box|case|pack|packs)|jumbo\s*(box|pack|packs)|blaster\s*(box|pack|packs)|retail\s*(box|pack|packs)|mega\s*box|hanger\s*(box|pack|packs)|value\s*box|cello\s*(box|pack|packs)|booster|wax\s*(box|pack|packs)|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
const SEALED_PRODUCT_WORDS_RE = /\b(factory|sealed|unopened|hobby|jumbo|blaster|retail|mega|hanger|value|cello|wax)\b/i;
const PRODUCT_CONTAINER_WORDS_RE = /\b(box|boxes|case|cases|pack|packs|product|wax)\b/i;
export function isNonSingleCardListing(title: string | null | undefined): boolean {
  const raw = compact(title);
  if (!raw) return false;
  return NON_SINGLE_CARD_RE.test(raw) || (SEALED_PRODUCT_WORDS_RE.test(raw) && PRODUCT_CONTAINER_WORDS_RE.test(raw));
}
// (graded regex intentionally inlined at call sites)

// Reject titles that clearly indicate a different variation than the submitted
// base card. Applies to both structured Cardsight pricing and pt130 comps.
export function isVariantTitle(
  title: string,
  opts: { hasSelectedParallel?: boolean; selectedParallelName?: string | null; set_name?: string | null; is_autograph?: boolean | null; serial_number?: string | null; is_first_bowman?: boolean | null } = {},
): boolean {
  if (!title) return false;
  if (isNonSingleCardListing(title)) return true;
  let variantTitle = title;
  for (const setTerm of expandSetSearchTerms(opts.set_name)) {
    const compactTerm = compact(setTerm);
    if (compactTerm.length < 4) continue;
    variantTitle = variantTitle.replace(new RegExp(escapeRegex(compactTerm), "gi"), " ");
  }
  variantTitle = variantTitle
    // Product/framing language, not a parallel color.
    .replace(/\btopps\s+gold\s+label\b/gi, "Topps Label")
    .replace(/\bgold\s+framed?\b/gi, "framed")
    .replace(/\bgold\s+label\b/gi, "label");
  const hasSelectedParallel = Boolean(opts.hasSelectedParallel || opts.selectedParallelName);
  if (opts.selectedParallelName) {
    if (!selectedParallelTitleMatches(variantTitle, opts.selectedParallelName)) return true;
    const selectedHasSerial = /\/\s*\d+/.test(opts.selectedParallelName);
    if (!selectedHasSerial && !opts.serial_number && SERIAL_RE.test(variantTitle)) return true;
    if (hasUnselectedParallelModifier(variantTitle, opts.selectedParallelName)) return true;
  }
  if (!hasSelectedParallel && PARALLEL_COLOR_RE.test(variantTitle)) return true;
  if (!hasSelectedParallel && REFRACTOR_FAMILY_RE.test(variantTitle)) return true;
  if (!hasSelectedParallel && WAVE_FAMILY_RE.test(variantTitle)) return true;
  if (!opts.is_first_bowman && FIRST_BOWMAN_RE.test(variantTitle)) return true;
  if (!hasSelectedParallel && !opts.serial_number && SERIAL_RE.test(variantTitle)) return true;
  if (!opts.is_autograph && AUTO_RE.test(variantTitle)) return true;
  return false;
}

export function titleMatchesCard(
  title: string,
  lookup: {
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    requireCardNumber?: boolean;
    /** If true, only reject when the title has an explicit `#XX` token that
     *  doesn't match. Titles with no explicit card number pass. */
    softCardNumber?: boolean;
  },
): boolean {
  const rawTitle = compact(title);
  if (!rawTitle) return false;
  const titleNorm = normalizeText(rawTitle);
  if (lookup.player_name) {
    const tokens = normalizeText(lookup.player_name).split(" ").filter((x) => x.length > 1);
    if (tokens.length > 0 && !tokens.every((x) => titleHasPhrase(titleNorm, x))) return false;
  }
  if (lookup.year && !new RegExp(`(^|[^0-9])${escapeRegex(compact(lookup.year))}($|[^0-9])`).test(rawTitle)) return false;
  if (!strictSetTitleMatches(rawTitle, lookup.set_name)) return false;
  const number = compact(lookup.card_number).replace(/^#\s*/, "");
  if (number && lookup.requireCardNumber !== false) {
    const wanted = normalizeCardNumber(number);
    if (lookup.softCardNumber) {
      const explicitNumbers = extractMarketplaceCardNumbers(title);
      if (explicitNumbers.length > 0 && !explicitNumbers.includes(wanted)) return false;
    } else if (!titleMentionsCardNumber(rawTitle, wanted)) {
      return false;
    }
  }
  return true;
}


function setTitleMatches(title: string, setName: string | null | undefined): boolean {
  return strictSetTitleMatches(title, setName);
}

function pricingRecordMatchesStructured(
  record: PricingRecord,
  lookup: {
    parallel_id?: string | null;
    is_autograph?: boolean | null;
    serial_number?: string | null;
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    is_first_bowman?: boolean | null;
    selected_parallel_name?: string | null;
    relaxedSetMatch?: boolean;
  },
): boolean {
  if (!Number.isFinite(record.price) || record.price <= 0) return false;
  if (isNonSingleCardListing(record.title)) return false;

  // This record came from /pricing/{canonical card_id}, with the requested
  // parallel_id and grade_id applied by CardSight. Do not re-identify that same
  // record from its seller-written title: titles are incomplete and card-number
  // suffixes such as 112-SP look like parallel keywords to a regex. The API's
  // canonical identity is the stronger evidence here.
  if (lookup.parallel_id) {
    return !record.parallel_id || record.parallel_id === lookup.parallel_id;
  }
  return !record.parallel_id;
}

function scoreCard(candidate: CatalogCard | SearchResult, lookup: CardLookup): number {
  const haystack = normalizeText([
    "releaseName" in candidate ? candidate.releaseName : null,
    "setName" in candidate ? candidate.setName : null,
    candidate.name,
    "number" in candidate ? candidate.number : null,
    "releaseYear" in candidate ? candidate.releaseYear : "year" in candidate ? candidate.year : null,
  ].filter(Boolean).join(" "));
  let score = "relevance" in candidate ? candidate.relevance : 0;
  const player = normalizeText(lookup.player_name);
  const setName = normalizeText(lookup.set_name);
  const number = normalizeText(lookup.card_number).replace(/^#/, "");
  const year = normalizeText(lookup.year);

  if (player && haystack.includes(player)) score += 50;
  if (setName && haystack.includes(setName)) score += 35;
  else if (expandSetSearchTerms(lookup.set_name).some((term) => haystack.includes(normalizeText(term)))) score += 35;
  if (year && haystack.includes(year)) score += 20;
  if (number && "number" in candidate && normalizeText(candidate.number) === number) score += 25;
  if (!lookup.is_autograph && /\b(auto|autograph|autographs|signature|signatures)\b/.test(haystack)) score -= 60;
  if (lookup.is_autograph && /\b(auto|autograph|autographs|signature|signatures)\b/.test(haystack)) score += 30;
  if ("variationOf" in candidate && candidate.variationOf) score -= 20;
  return score;
}

// A collector writes the number the way it's printed on the card ("112-SP");
// the catalog often stores only the base number ("112") and encodes the
// variation in the subset. Accept that as the same number.
function cardNumbersEquivalent(wanted: string, candidate: string): boolean {
  if (!wanted || !candidate) return false;
  if (wanted === candidate) return true;
  const stripVariantSuffix = (v: string) => v.replace(/(sp|ssp|var|a|b)$/i, "");
  return stripVariantSuffix(wanted) === candidate || wanted === stripVariantSuffix(candidate);
}

function cardMatchesLookup(candidate: CatalogCard, lookup: CardLookup): boolean {
  const playerTokens = normalizeText(lookup.player_name)
    .split(" ")
    .filter((t) => t.length > 1);
  const candidateName = normalizeText(candidate.name);
  if (playerTokens.length > 0 && !playerTokens.every((t) => candidateName.includes(t))) return false;

  const year = compact(lookup.year);
  if (year && compact(candidate.releaseYear) !== year) return false;

  const wantedNumber = normalizeCardNumber(lookup.card_number);
  if (wantedNumber && !cardNumbersEquivalent(wantedNumber, normalizeCardNumber(candidate.number))) return false;

  const candidateSet = sanitizeSetName(candidate.releaseName, candidate.setName);
  if (!candidateSet) return false;
  const wantedSet = toApprovedCardSet(lookup.set_name);
  if (wantedSet && candidateSet !== wantedSet) return false;

  return true;
}


function setCandidateFromCard(card: CatalogCard, lookup: CardLookup): SetCandidate | null {
  const setName = sanitizeSetName(card.releaseName, card.setName);
  if (!setName) return null;
  return {
    card_id: card.id,
    set_name: setName,
    release_name: card.releaseName ?? null,
    subset_name: card.setName ?? null,
    player_name: card.name ?? null,
    year: card.releaseYear ?? null,
    card_number: card.number ?? null,
    relevance: scoreCard(card, lookup),
  };
}

export async function listSetCandidatesForCard(lookup: CardLookup): Promise<SetCandidate[]> {
  const descriptorLookup = lookup.descriptor ? parseDescriptor(lookup.descriptor) : {};
  const merged: CardLookup = { ...descriptorLookup, ...lookup };
  const player = merged.player_name?.trim();
  const year = merged.year == null ? null : String(merged.year).trim();
  const setName = merged.set_name?.trim();
  const number = merged.card_number?.trim().replace(/^#\s*/, "");

  const paths = new Set<string>();
  const addCardsPath = (params: Record<string, string | null | undefined>) => {
    const sp = new URLSearchParams({ take: "50" });
    Object.entries(params).forEach(([key, value]) => {
      if (value) sp.set(key, value);
    });
    if ([...sp.keys()].length > 1) paths.add(`/v1/catalog/cards?${sp.toString()}`);
  };

  addCardsPath({ name: player, number, year, releaseName: setName });
  addCardsPath({ name: player, number, year, setName });
  addCardsPath({ name: player, number, year });
  addCardsPath({ number, year });
  addCardsPath({ name: player, year });

  const cardsById = new Map<string, CatalogCard>();
  if (merged.card_id) {
    try {
      const detail = await csFetch<CatalogCard>(`/v1/catalog/cards/${merged.card_id}`);
      cardsById.set(detail.id, detail);
    } catch (err) {
      console.error("Cardsight set candidate detail failed:", err);
    }
  }
  for (const path of paths) {
    try {
      const resp = await csFetch<{ cards: CatalogCard[] }>(path);
      for (const card of resp.cards ?? []) cardsById.set(card.id, card);
    } catch (err) {
      console.error("Cardsight set candidates lookup failed:", err);
    }
  }

  if (cardsById.size === 0) {
    const queries = new Set<string>();
    if (player && year && number) queries.add([year, player, `#${number}`].join(" "));
    if (player && year && setName) queries.add([year, setName, player].join(" "));
    if (merged.descriptor) queries.add(merged.descriptor);
    for (const q of queries) {
      if (q.trim().length < 2) continue;
      try {
        const resp = await csFetch<{ results: SearchResult[] }>(
          `/v1/catalog/search?type=card&take=25&q=${encodeURIComponent(q.slice(0, 200))}`,
        );
        for (const result of resp.results ?? []) {
          if (result.type !== "card" || cardsById.has(result.id)) continue;
          try {
            const detail = await csFetch<CatalogCard>(`/v1/catalog/cards/${result.id}`);
            cardsById.set(detail.id, detail);
          } catch {
            // Ignore detail misses; only actual catalog card details are shown.
          }
        }
      } catch (err) {
        console.error("Cardsight set candidates search failed:", err);
      }
    }
  }

  const bySet = new Map<string, SetCandidate>();
  for (const card of cardsById.values()) {
    if (!cardMatchesLookup(card, merged)) continue;
    const candidate = setCandidateFromCard(card, merged);
    if (!candidate) continue;
    const existing = bySet.get(candidate.set_name);
    if (!existing || candidate.relevance > existing.relevance) bySet.set(candidate.set_name, candidate);
  }

  return [...bySet.values()]
    .sort((a, b) => b.relevance - a.relevance || a.set_name.localeCompare(b.set_name))
    .slice(0, 20);
}

function expandSetSearchTerms(setName: string | null | undefined): string[] {
  const raw = String(setName ?? "").trim();
  if (!raw) return [];
  const variants = new Set<string>([raw]);
  const simplified = raw
    .replace(/all[-\s]*stars?/gi, "All")
    .replace(/all[-\s]*star\s+aces/gi, "All Aces")
    .replace(/\bseries\s+\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (simplified) variants.add(simplified);
  const noBrandNoise = simplified
    .replace(/\bbase\s+set\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (noBrandNoise) variants.add(noBrandNoise);
  return [...variants];
}

function parseDescriptor(descriptor: string): CardLookup {
  const trimmed = descriptor.trim().replace(/\s+/g, " ");
  const year = trimmed.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const cardNumber = trimmed.match(/#\s*([A-Za-z0-9.-]+)\b/)?.[1] ?? null;
  return { descriptor: trimmed, year, card_number: cardNumber };
}

// Resolving a catalog card costs several requests. The valuation pipeline asks
// for the same lookup more than once per card, so memoize by lookup identity.
const catalogLookupCache = new Map<string, { at: number; card: CatalogCard | null }>();
const CATALOG_LOOKUP_TTL_MS = 15 * 60 * 1000;

export async function findCatalogCard(lookup: CardLookup): Promise<CatalogCard | null> {
  const cacheKey = JSON.stringify([
    lookup.player_name ?? null,
    lookup.year ?? null,
    lookup.set_name ?? null,
    lookup.card_number ?? null,
    lookup.descriptor ?? null,
    lookup.is_autograph ?? null,
  ]);
  const cachedLookup = catalogLookupCache.get(cacheKey);
  if (cachedLookup && Date.now() - cachedLookup.at < CATALOG_LOOKUP_TTL_MS) return cachedLookup.card;

  const card = await findCatalogCardUncached(lookup);
  catalogLookupCache.set(cacheKey, { at: Date.now(), card });
  return card;
}

async function findCatalogCardUncached(lookup: CardLookup): Promise<CatalogCard | null> {
  const descriptorLookup = lookup.descriptor ? parseDescriptor(lookup.descriptor) : {};
  const merged: CardLookup = { ...descriptorLookup, ...lookup };
  const player = merged.player_name?.trim();
  const year = merged.year == null ? null : String(merged.year).trim();
  const setName = merged.set_name?.trim();
  const number = merged.card_number?.trim().replace(/^#\s*/, "");

  const attempts: string[] = [];
  const addCardsAttempt = (params: Record<string, string | null | undefined>) => {
    const sp = new URLSearchParams({ take: "25" });
    Object.entries(params).forEach(([key, value]) => {
      if (value) sp.set(key, value);
    });
    attempts.push(`/v1/catalog/cards?${sp.toString()}`);
  };

  // The structured cards endpoint handles exact number/year/release filters far
  // better than free-text search, especially when a descriptor contains "#28".
  // Keep catalog resolution bounded. The old eight-query cascade was the main
  // source of runaway API usage when a card was absent or described slightly
  // differently in the catalog.
  addCardsAttempt({ name: player, number, year, releaseName: setName });
  addCardsAttempt({ name: player, number, year, setName });
  // The catalog frequently stores the base number ("112") for cards printed as
  // "112-SP", and names releases differently than collectors do ("Topps Black &
  // White" vs "Topps Black and White"). Those two mismatches made the filtered
  // queries above return zero rows and pushed perfectly common cards to an AI
  // guess. Sweeping the player's year once and matching locally fixes both, in
  // a single extra request.
  const baseNumber = number ? number.replace(/[^a-z0-9]*(sp|ssp)$/i, "") : null;
  if (baseNumber && baseNumber !== number) {
    addCardsAttempt({ name: player, number: baseNumber, year, releaseName: setName });
  }
  if (player && year) addCardsAttempt({ name: player, year, take: "100" });

  const seen = new Set<string>();
  const candidates: CatalogCard[] = [];
  let resolved: CatalogCard | null = null;
  for (const path of attempts) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const resp = await csFetch<{ cards: CatalogCard[] }>(path);
      candidates.push(...(resp.cards ?? []));
    } catch (err) {
      console.error("Cardsight cards lookup failed:", err);
    }
    if (candidates.length === 0) continue;
    const matched = candidates.filter((c) => cardMatchesLookup(c, merged));
    if (matched.length > 0) {
      resolved = matched.sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged))[0];
      break;
    }
  }
  if (resolved) return resolved;

  if (candidates.length > 0) {
    const yearAgnosticMatched = year
      ? candidates.filter((c) => cardMatchesLookup(c, { ...merged, year: null }))
      : [];
    if (yearAgnosticMatched.length > 0) {
      return yearAgnosticMatched.sort((a, b) => scoreCard(b, { ...merged, year: null }) - scoreCard(a, { ...merged, year: null }))[0];
    }
  }


  const searchQueries = new Set<string>();
  if (merged.descriptor) searchQueries.add(merged.descriptor);
  else if (player) searchQueries.add([year, setName, player, number ? `#${number}` : null].filter(Boolean).join(" "));

  const searchCandidates = new Map<string, SearchResult>();
  for (const textQuery of searchQueries) {
    if (textQuery.trim().length < 2) continue;
    try {
      const resp = await csFetch<{ results: SearchResult[] }>(
        `/v1/catalog/search?type=card&take=25&q=${encodeURIComponent(textQuery.slice(0, 200))}`,
      );
      for (const result of resp.results ?? []) {
        if (result.type === "card" && !searchCandidates.has(result.id)) {
          searchCandidates.set(result.id, result);
        }
      }
    } catch (err) {
      console.error("Cardsight search lookup failed:", err);
    }
  }

  if (searchCandidates.size > 0) {
    // Detail fetches are billed per call. Inspect at most the top two results;
    // a broad ten-result escalation costs more without providing dependable
    // identity evidence.
    const ranked = [...searchCandidates.values()].sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged));
    const detailed: CatalogCard[] = [];
    const batches = [ranked.slice(0, 1)];

    for (const batch of batches) {
      if (batch.length === 0) continue;
      for (const result of batch) {
        try {
          detailed.push(await csFetch<CatalogCard>(`/v1/catalog/cards/${result.id}`));
        } catch {
          // Fall back to scoring the lightweight search result below.
        }
      }
      const matched = detailed.filter((c) => cardMatchesLookup(c, merged));
      if (matched.length > 0) return matched.sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged))[0];
    }

    const yearAgnosticMatched = year
      ? detailed.filter((c) => cardMatchesLookup(c, { ...merged, year: null }))
      : [];
    if (yearAgnosticMatched.length > 0) {
      return yearAgnosticMatched.sort((a, b) => scoreCard(b, { ...merged, year: null }) - scoreCard(a, { ...merged, year: null }))[0];
    }
    // Never accept an unverified top result merely because it was returned by
    // search; that both wastes a request and risks saving the wrong card ID.
  }


  return null;
}

export async function searchCatalogCardByFields(lookup: CardLookup): Promise<string | null> {
  return (await findCatalogCard(lookup))?.id ?? null;
}

export async function searchCatalogCard(descriptor: string): Promise<string | null> {
  const q = descriptor.trim().replace(/\s+/g, " ");
  if (q.length < 2) return null;
  try {
    const structured = await findCatalogCard({ descriptor: q });
    if (structured?.id) return structured.id;
    const resp = await csFetch<{ results: SearchResult[] }>(
      `/v1/catalog/search?type=card&take=5&q=${encodeURIComponent(q.slice(0, 200))}`,
    );
    const card = resp.results.find((r) => r.type === "card");
    return card?.id ?? null;
  } catch (err) {
    console.error("Cardsight search failed:", err);
    return null;
  }
}

export async function getCatalogValuationLookup(card_id: string): Promise<CardLookup | null> {
  try {
    const card = await csFetch<CatalogCard>(`/v1/catalog/cards/${card_id}`);
    return {
      player_name: card.name ?? null,
      year: card.releaseYear ? Number(card.releaseYear) || card.releaseYear : null,
      set_name: sanitizeSetName(card.releaseName, card.setName),
      card_number: card.number ?? null,
      is_autograph: /\b(auto|autograph|autographs|signature|signatures)\b/i.test(
        [card.releaseName, card.setName, card.name, card.description].filter(Boolean).join(" "),
      ),
    };
  } catch (err) {
    console.error("Cardsight catalog detail failed:", err);
    return null;
  }
}

// ---------- Parallels for a card's release (scoped to the card's set) ----------
export type ParallelOption = { id: string; name: string; setId: string };

type DetailedCard = CatalogCard;
type ParallelsResp = {
  parallels: Array<{ id: string; setId: string; name: string; isPartial?: boolean }>;
  total_count: number;
};

const catalogCache = new Map<string, DetailedCard>();
const parallelsCache = new Map<string, ParallelOption[]>();

export async function listParallelsForCard(card_id: string): Promise<ParallelOption[]> {
  const cached = parallelsCache.get(card_id);
  if (cached) return cached;
  let card = catalogCache.get(card_id);
  if (!card) {
    card = await csFetch<DetailedCard>(`/v1/catalog/cards/${card_id}`);
    catalogCache.set(card_id, card);
  }

  if (card.variationOf) {
    const baseParallels = await listParallelsForCard(card.variationOf);
    if (baseParallels.length > 0) {
      parallelsCache.set(card_id, baseParallels);
      return baseParallels;
    }
  }

  // The card detail response already returns the exact parallels/refractors
  // available for this card's own set. Prefer it over release-wide filtering.
  if (Array.isArray(card.parallels) && card.parallels.length > 0) {
    const scoped = card.parallels
      .map((p) => ({
        id: p.id,
        name: p.numberedTo ? `${p.name} /${p.numberedTo}` : p.name,
        setId: card.setId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    parallelsCache.set(card_id, scoped);
    return scoped;
  }

  const all: ParallelOption[] = [];
  let skip = 0;
  const take = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await csFetch<ParallelsResp>(
      `/v1/catalog/parallels?releaseId=${encodeURIComponent(card.releaseId)}&take=${take}&skip=${skip}`,
    );
    for (const p of page.parallels) {
      if (p.setId === card.setId) all.push({ id: p.id, name: p.name, setId: p.setId });
    }
    skip += page.parallels.length;
    if (page.parallels.length < take || skip >= page.total_count) break;
  }
  // Sort by name for stable UI order.
  all.sort((a, b) => a.name.localeCompare(b.name));
  parallelsCache.set(card_id, all);
  return all;
}

export async function getParallelNameForCard(card_id: string, parallel_id: string | null | undefined): Promise<string | null> {
  if (!parallel_id) return null;
  const option = (await listParallelsForCard(card_id)).find((p) => p.id === parallel_id);
  return option?.name ?? null;
}

// ---------- Grade resolution: (grader, grade) → cardsight grade_id ----------
type Company = { id: string; name: string };
type GradingType = { id: string; name: string };
type Grade = { id: string; grade: string };

const gradeIdCache = new Map<string, string | null>();
let companiesCache: Company[] | null = null;

async function loadCompanies(): Promise<Company[]> {
  if (companiesCache) return companiesCache;
  const j = await csFetch<{ companies: Company[] }>("/v1/grades/companies");
  companiesCache = j.companies;
  return companiesCache;
}

export async function resolveGradeId(
  grader: string | null | undefined,
  grade: string | null | undefined,
): Promise<string | null> {
  if (!grader || !grade) return null;
  const key = `${grader.toLowerCase()}|${grade.toLowerCase()}`;
  if (gradeIdCache.has(key)) return gradeIdCache.get(key) ?? null;
  try {
    const companies = await loadCompanies();
    const company = companies.find((c) => c.name.toLowerCase() === grader.toLowerCase());
    if (!company) {
      gradeIdCache.set(key, null);
      return null;
    }
    const types = await csFetch<{ types: GradingType[] }>(
      `/v1/grades/companies/${company.id}/types`,
    );
    // Prefer "Regular" grading type; fall back to first.
    const type =
      types.types.find((t) => /regular/i.test(t.name)) ?? types.types[0];
    if (!type) {
      gradeIdCache.set(key, null);
      return null;
    }
    const grades = await csFetch<{ grades: Grade[] }>(
      `/v1/grades/companies/${company.id}/types/${type.id}/grades`,
    );
    const wanted = grade.trim().toLowerCase();
    const match = grades.grades.find((g) => g.grade.toLowerCase() === wanted);
    const id = match?.id ?? null;
    gradeIdCache.set(key, id);
    return id;
  } catch (err) {
    console.error("resolveGradeId failed:", err);
    gradeIdCache.set(key, null);
    return null;
  }
}

// ---------- Pricing ----------
// Cardsight's /pricing endpoint returns market comps; `listing_type` describes
// how the transaction/listing was formatted (auction vs fixed), not whether the
// record is usable. Valuation uses the records returned by the structured API.
export type PricingSlice = {
  auctionSales: PricingRecord[];
  askListings: PricingRecord[];  // kept for API-shape compatibility (unused)
  gradeLabel: string | null;
  cardIdentity: { card_id: string; name: string } | null;
  rawResponseMeta?: { query?: Record<string, unknown>; messages?: Array<{ code?: string; message?: string }> };
};

export async function fetchPricing(
  card_id: string,
  opts: {
    parallel_id?: string | null;
    grade_id?: string | null;
    player_name?: string | null;
    year?: string | number | null;
    set_name?: string | null;
    card_number?: string | null;
    grader?: string | null;
    grade?: string | null;
    is_autograph?: boolean | null;
    is_first_bowman?: boolean | null;
    serial_number?: string | null;
    selected_parallel_name?: string | null;
    period?: string;
    limit?: number;
    relaxedSetMatch?: boolean;
  } = {},
): Promise<PricingSlice> {
  const params = new URLSearchParams();
  // Keep the default request aligned with our valuation window:
  // GET /v1/pricing/{card_id}?period=6m. Cardsight's /pricing endpoint only
  // returns completed transactions (both auction sales and fixed-price BIN
  // sales) — active/unsold listings are not included. Omit listing_type so we
  // get both; passing "auction" here would filter out BIN sales entirely.
  params.set("period", opts.period ?? "all");
  // CardSight documents omission as "all variants/grades". An explicit null
  // means base or raw only, which is what an unselected parallel/ungraded card
  // represents in Vault.03.
  params.set("parallel_id", opts.parallel_id ?? "null");
  params.set("grade_id", opts.grade_id ?? "null");
  params.set("limit", String(Math.min(opts.limit ?? 500, 500)));
  const resp = await csFetch<PricingResponse>(
    `/v1/pricing/${card_id}?${params.toString()}`,
  );


  let records: PricingRecord[] = [];
  let gradeLabel: string | null = null;
  const wantedGrader = normalizeText(opts.grader);
  const wantedGrade = normalizeText(opts.grade);
  if (opts.grade_id || wantedGrade || wantedGrader) {
    for (const company of resp.graded) {
      const g = company.grades.find((gr) => {
        if (opts.grade_id && gr.grade_id === opts.grade_id) return true;
        const companyMatches = !wantedGrader || normalizeText(company.company_name) === wantedGrader;
        const gradeMatches = !wantedGrade || normalizeText(gr.grade_value) === wantedGrade;
        return companyMatches && gradeMatches;
      });
      if (g) {
        records = g.records;
        gradeLabel = `${company.company_name} ${g.grade_value}`;
        break;
      }
    }
    // If the requested graded bucket is absent, leave records empty instead of
    // silently pricing a graded card from raw comps.
  } else {
    records = resp.raw?.records ?? [];
  }

  records = records.filter((r) => pricingRecordMatchesStructured(r, opts));

  return {
    auctionSales: records,
    askListings: [],
    gradeLabel,
    cardIdentity: resp.card ?? null,
    rawResponseMeta: { query: resp.query, messages: resp.messages },
  };
}

type PricingSearchResponse = {
  query?: Record<string, unknown>;
  results?: PricingRecord[];
  meta?: Record<string, unknown>;
  messages?: Array<{ code?: string; message?: string }>;
};

type PricingSearchLookup = CardLookup & {
  serial_number?: string | null;
  grader?: string | null;
  grade?: string | null;
  selected_parallel_name?: string | null;
  relaxedSetMatch?: boolean;
};

function setBrand(setName: string | null | undefined): string | null {
  const n = normalizeText(setName);
  const brands = [
    "bowman chrome",
    "bowman",
    "topps chrome",
    "topps",
    "bbm",
    "panini",
    "donruss",
    "fleer",
    "upper deck",
    "ultra",
    "select",
    "prizm",
  ];
  return brands.find((b) => n.includes(b)) ?? null;
}

function uniquePricingQueries(lookup: PricingSearchLookup): string[] {
  const player = compact(lookup.player_name);
  const year = compact(lookup.year);
  const set = compact(lookup.set_name)
    .replace(/\bbase\s+set\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const brand = setBrand(lookup.set_name);
  const number = compact(lookup.card_number).replace(/^#\s*/, "");
  const auto = lookup.is_autograph ? "auto" : null;
  const serial = serialSearchTerm(lookup.serial_number);
  const parallel = compact(lookup.selected_parallel_name).replace(/\/\s*\d+/g, " ").trim() || null;
  const grade = compact([lookup.grader, lookup.grade].filter(Boolean).join(" ")) || null;
  const variants = [auto, parallel, serial, grade].filter(Boolean) as string[];
  const strictCandidates = [
    [year, set, player, ...variants, number],
    [player, year, set, ...variants, number],
    [player, set, ...variants, number],
  ];
  const candidates = variants.length > 0
    ? strictCandidates
    : [
        ...strictCandidates,
        [year, player, brand, number],
        [player, brand, number],
      ];
  const seen = new Set<string>();
  return candidates
    .map((parts) => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
    .filter((q) => {
      if (q.length < 2 || seen.has(q)) return false;
      seen.add(q);
      return true;
    });
}

function dedupePricingRecords(records: PricingRecord[]): PricingRecord[] {
  const seen = new Set<string>();
  const out: PricingRecord[] = [];
  for (const r of records) {
    const key = [r.url, r.title, r.date, r.price].map((v) => String(v ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });
}

export async function searchPricingComps(
  lookup: PricingSearchLookup,
  opts: { period?: string; limit?: number } = {},
): Promise<PricingSlice> {
  // Try the most specific queries first (cheap happy path), then fall through
  // to the looser ones only when nothing verified — never give up early.
  const queries = uniquePricingQueries(lookup);
  const period = opts.period ?? "30d";
  const limit = opts.limit ?? 100;
  const all: PricingRecord[] = [];
  let lastMeta: PricingSlice["rawResponseMeta"] = undefined;

  // Search is a last-resort fallback. Two tightly scoped queries provide a
  // bounded escape hatch without allowing one card to consume dozens of calls.
  for (const q of queries.slice(0, 2)) {
    const params = new URLSearchParams({ q, period, limit: String(Math.min(limit, 500)) });
    const resp = await csFetch<PricingSearchResponse>(`/v1/pricing/search?${params.toString()}`);
    lastMeta = { query: resp.query, messages: resp.messages };
    const matches = (resp.results ?? []).filter(
      (r) => pricingRecordMatches(r, lookup),
    );

    if (matches.length > 0) {
      all.push(...matches);
      break;
    }
  }

  return {
    auctionSales: dedupePricingRecords(all),
    askListings: [],
    gradeLabel: compact([lookup.grader, lookup.grade].filter(Boolean).join(" ")) || null,
    cardIdentity: null,
    rawResponseMeta: lastMeta,
  };
}

// ---------- Stats helpers used by the valuation pipeline ----------
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function trimOutliersIQR(values: number[]): number[] {
  if (values.length < 5) return values;
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.floor((s.length - 1) * p)];
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const trimmed = s.filter((v) => v >= lo && v <= hi);
  return trimmed.length >= 3 ? trimmed : s;
}

// Unfiltered candidate pull for the manual-comp picker. Includes raw + all
// graded buckets, tagged with grade in the source so the UI can label them.
export async function fetchAllCompCandidates(
  card_id: string,
  opts: { period?: string } = {},
): Promise<PricingRecord[]> {
  const params = new URLSearchParams();
  params.set("period", opts.period ?? "5y");
  const resp = await csFetch<PricingResponse>(`/v1/pricing/${card_id}?${params.toString()}`);
  const rows: PricingRecord[] = [];
  for (const r of resp.raw?.records ?? []) rows.push(r);
  for (const co of resp.graded ?? []) {
    for (const g of co.grades ?? []) {
      for (const r of g.records ?? []) {
        const label = `${co.company_name} ${g.grade_value}`;
        rows.push({ ...r, source: r.source ? `${r.source} · ${label}` : label });
      }
    }
  }
  return dedupePricingRecords(rows);
}

