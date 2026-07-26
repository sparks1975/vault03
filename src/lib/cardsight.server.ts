// Server-only Cardsight REST client. Do not import from client-reachable modules
// at top level. See https://cardsight.ai/documentation/api-reference.
import { toApprovedCardSet } from "./card-sets";

const REST_BASE = "https://api.cardsight.ai";

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

async function csFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let lastBody = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
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
    const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 800 * Math.pow(2, attempt));
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  throw new Error(`Cardsight ${path} ${lastStatus}: ${lastBody.slice(0, 200)}`);
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
  const catalogLookup = c.id ? await getCatalogValuationLookup(c.id) : null;
  const catalogYear = catalogLookup?.year == null ? null : Number(catalogLookup.year) || null;
  return {
    cardsight_card_id: c.id ?? null,
    cardsight_parallel_id: c.parallel?.id ?? null,
    player_name: catalogLookup?.player_name ?? c.name ?? null,
    team: null,
    position: null,
    year: catalogYear ?? (c.year ? Number(c.year) || null : null),
    set_name: catalogLookup?.set_name ?? sanitizeSetName(c.releaseName, c.setName),
    card_number: catalogLookup?.card_number ?? c.number ?? null,
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

export function extractMarketplaceCardNumbers(title: string): string[] {
  const values = new Set<string>();
  const patterns = [
    /#\s*([A-Za-z0-9][A-Za-z0-9.-]{0,14})\b/g,
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
  },
): boolean {
  const rawTitle = record.title ?? "";
  if (!rawTitle.trim()) return false;
  const title = normalizeText(rawTitle);
  const playerTokens = normalizeText(lookup.player_name)
    .split(" ")
    .filter((t) => t.length > 1);
  if (playerTokens.length > 0 && !playerTokens.every((t) => title.includes(t))) return false;
  const year = compact(lookup.year);
  if (year && !rawTitle.includes(year)) return false;
  if (!setTitleMatches(rawTitle, lookup.set_name)) return false;
  const number = compact(lookup.card_number).replace(/^#\s*/, "");
  if (number) {
    const explicitNumbers = extractMarketplaceCardNumbers(rawTitle);
    const wanted = normalizeCardNumber(number);
    if (explicitNumbers.length > 0) {
      if (!explicitNumbers.includes(wanted)) return false;
    } else {
      const numberPattern = new RegExp(`(^|[^a-z0-9])#?${escapeRegex(number)}($|[^a-z0-9])`, "i");
      if (!numberPattern.test(rawTitle)) return false;
    }
  }

  const isAutoTitle = /\b(auto|autograph|autographs|signed|signature)\b/i.test(rawTitle);
  if (lookup.is_autograph && !isAutoTitle) return false;
  if (!lookup.is_autograph && isAutoTitle) return false;

  const serial = serialSearchTerm(lookup.serial_number);
  if (serial && !rawTitle.toLowerCase().includes(serial.toLowerCase())) return false;

  // Grader/grade are considered but never required — many marketplace titles
  // omit the grader name (or use only the grade number). Filtering on them
  // eliminated legitimate comps for niche graders (e.g. Arena Club).

  if (isVariantTitle(rawTitle, {
    is_autograph: lookup.is_autograph,
    serial_number: lookup.serial_number,
    is_first_bowman: lookup.is_first_bowman,
    selectedParallelName: lookup.selected_parallel_name,
  })) return false;

  return Number.isFinite(record.price) && record.price > 0;
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
// Reject non-single-card listings: breaks, cases, boxes, packs, lots, sets.
// These are group-buy / sealed-product listings whose prices are orders of
// magnitude higher than an individual card and must never be used as comps.
const NON_SINGLE_CARD_RE = /\b(case\s*break|player\s*break|team\s*break|group\s*break|random\s*(team|player|division)|box\s*break|break\s*#?\d*|hobby\s*box|jumbo\s*box|blaster\s*box|retail\s*box|mega\s*box|hanger\s*box|value\s*box|cello\s*box|sealed\s*box|factory\s*sealed|hobby\s*case|sealed\s*case|pack(s)?|booster|complete\s*set|factory\s*set|master\s*set|team\s*set|(\d+)\s*(box(es)?|case(s)?|pack(s)?|card\s*lot)|lot\s*of\s*\d+|card\s*lot|\d+\s*card\s*lot|repack|mixer)\b/i;
// (graded regex intentionally inlined at call sites)

// Reject titles that clearly indicate a different variation than the submitted
// base card. Applies to both structured Cardsight pricing and pt130 comps.
export function isVariantTitle(
  title: string,
  opts: { hasSelectedParallel?: boolean; selectedParallelName?: string | null; is_autograph?: boolean | null; serial_number?: string | null; is_first_bowman?: boolean | null } = {},
): boolean {
  if (!title) return false;
  if (NON_SINGLE_CARD_RE.test(title)) return true;
  const variantTitle = title
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
  if (!title.trim()) return false;
  if (lookup.player_name) {
    const t = normalizeText(title);
    const tokens = normalizeText(lookup.player_name).split(" ").filter((x) => x.length > 1);
    if (tokens.length > 0 && !tokens.every((x) => t.includes(x))) return false;
  }
  if (lookup.year && !String(title).includes(String(lookup.year))) return false;
  if (!setTitleMatches(title, lookup.set_name)) return false;
  const number = compact(lookup.card_number).replace(/^#\s*/, "");
  if (number && lookup.requireCardNumber !== false) {
    const explicitNumbers = extractMarketplaceCardNumbers(title);
    const wanted = normalizeCardNumber(number);
    if (explicitNumbers.length > 0) {
      if (!explicitNumbers.includes(wanted)) return false;
    } else if (lookup.softCardNumber) {
      // Soft mode: no explicit #XX in title — trust player+year+set match.
      return true;
    } else {
      const numRe = new RegExp(`(^|[^a-z0-9])#?${escapeRegex(number)}($|[^a-z0-9])`, "i");
      if (!numRe.test(title)) return false;
    }
  }
  return true;
}


function setTitleMatches(title: string, setName: string | null | undefined): boolean {
  const terms = expandSetSearchTerms(setName)
    .map((term) => normalizeText(term))
    .filter(Boolean);
  if (terms.length === 0) return true;
  const titleNorm = normalizeText(title);
  const stop = new Set(["base", "card", "cards", "insert", "set", "series"]);
  return terms.some((term) => {
    const tokens = term.split(" ").filter((t) => t.length > 1 && !stop.has(t));
    return tokens.length === 0 || tokens.every((t) => titleNorm.includes(t));
  });
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
  },
): boolean {
  if (!Number.isFinite(record.price) || record.price <= 0) return false;

  const hasSelectedParallel = Boolean(lookup.parallel_id);
  if (lookup.parallel_id) {
    if (record.parallel_id && record.parallel_id !== lookup.parallel_id) return false;
  } else if (record.parallel_id || record.parallel_name) {
    return false;
  }

  const rawTitle = record.title ?? "";

  // Defensive: even though the structured endpoint is scoped by canonical
  // card_id, if the wrong catalog card was matched (e.g. a completely
  // different player) the returned comps would silently pollute pricing.
  // Require player-name tokens, year, and card_number to appear in the title
  // when we have them.
  if (!titleMatchesCard(rawTitle, lookup)) return false;

  const isAutoTitle = AUTO_RE.test(rawTitle);
  if (lookup.is_autograph && !isAutoTitle) return false;
  if (!lookup.is_autograph && isAutoTitle) return false;

  const serial = serialSearchTerm(lookup.serial_number);
  if (serial && !rawTitle.toLowerCase().includes(serial.toLowerCase())) return false;

  if (isVariantTitle(rawTitle, { hasSelectedParallel, selectedParallelName: lookup.selected_parallel_name, is_autograph: lookup.is_autograph, serial_number: lookup.serial_number, is_first_bowman: lookup.is_first_bowman })) {
    return false;
  }

  return true;
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

function cardMatchesLookup(candidate: CatalogCard, lookup: CardLookup): boolean {
  const playerTokens = normalizeText(lookup.player_name)
    .split(" ")
    .filter((t) => t.length > 1);
  const candidateName = normalizeText(candidate.name);
  if (playerTokens.length > 0 && !playerTokens.every((t) => candidateName.includes(t))) return false;

  const year = compact(lookup.year);
  if (year && compact(candidate.releaseYear) !== year) return false;

  const wantedNumber = normalizeCardNumber(lookup.card_number);
  if (wantedNumber && normalizeCardNumber(candidate.number) !== wantedNumber) return false;

  return Boolean(sanitizeSetName(candidate.releaseName, candidate.setName));
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

export async function findCatalogCard(lookup: CardLookup): Promise<CatalogCard | null> {
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
  addCardsAttempt({ name: player, number, year, releaseName: setName });
  addCardsAttempt({ name: player, number, year, setName });
  addCardsAttempt({ number, year, releaseName: setName });
  addCardsAttempt({ name: player, year, releaseName: setName });
  // If the scanned/edited year is wrong, an exact-year lookup returns nothing
  // even when player + set + card number uniquely identify the catalog card.
  // Retry without year before falling back to loose text search.
  addCardsAttempt({ name: player, number, releaseName: setName });
  addCardsAttempt({ name: player, number, setName });
  addCardsAttempt({ number, releaseName: setName });
  addCardsAttempt({ name: player, releaseName: setName });

  const seen = new Set<string>();
  const candidates: CatalogCard[] = [];
  for (const path of attempts) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const resp = await csFetch<{ cards: CatalogCard[] }>(path);
      candidates.push(...(resp.cards ?? []));
      if (candidates.length > 0) break;
    } catch (err) {
      console.error("Cardsight cards lookup failed:", err);
    }
  }

  if (candidates.length > 0) {
    const matched = candidates.filter((c) => cardMatchesLookup(c, merged));
    if (matched.length > 0) return matched.sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged))[0];
    const yearAgnosticMatched = year
      ? candidates.filter((c) => cardMatchesLookup(c, { ...merged, year: null }))
      : [];
    if (yearAgnosticMatched.length > 0) {
      return yearAgnosticMatched.sort((a, b) => scoreCard(b, { ...merged, year: null }) - scoreCard(a, { ...merged, year: null }))[0];
    }
  }

  const searchQueries = new Set<string>();
  for (const setTerm of expandSetSearchTerms(setName)) {
    if (player) searchQueries.add([player, setTerm].filter(Boolean).join(" "));
    if (year && player) searchQueries.add([year, player, setTerm].filter(Boolean).join(" "));
  }
  if (merged.descriptor) searchQueries.add(merged.descriptor);
  if (player && searchQueries.size === 0) searchQueries.add(player);

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
    const detailed: CatalogCard[] = [];
    for (const result of [...searchCandidates.values()].slice(0, 10)) {
      try {
        detailed.push(await csFetch<CatalogCard>(`/v1/catalog/cards/${result.id}`));
      } catch {
        // Fall back to scoring the lightweight search result below.
      }
    }
    if (detailed.length > 0) {
      const matched = detailed.filter((c) => cardMatchesLookup(c, merged));
      if (matched.length > 0) return matched.sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged))[0];
      const yearAgnosticMatched = year
        ? detailed.filter((c) => cardMatchesLookup(c, { ...merged, year: null }))
        : [];
      if (yearAgnosticMatched.length > 0) {
        return yearAgnosticMatched.sort((a, b) => scoreCard(b, { ...merged, year: null }) - scoreCard(a, { ...merged, year: null }))[0];
      }
    }
    const card = [...searchCandidates.values()].sort((a, b) => scoreCard(b, merged) - scoreCard(a, merged))[0];
    if (card) return await csFetch<CatalogCard>(`/v1/catalog/cards/${card.id}`);
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
  } = {},
): Promise<PricingSlice> {
  const params = new URLSearchParams();
  // Keep the default request aligned with our valuation window:
  // GET /v1/pricing/{card_id}?period=6m. Cardsight's /pricing endpoint only
  // returns completed transactions (both auction sales and fixed-price BIN
  // sales) — active/unsold listings are not included. We include both types.
  params.set("period", opts.period ?? "5y");
  if (opts.parallel_id) params.set("parallel_id", opts.parallel_id);
  if (opts.grade_id) params.set("grade_id", opts.grade_id);
  if (opts.limit) params.set("limit", String(opts.limit));
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
    [year, set, player, number, ...variants],
    [player, year, set, number, ...variants],
    [player, set, number, ...variants],
    [player, set, ...variants],
  ];
  const candidates = variants.length > 0
    ? strictCandidates
    : [
        ...strictCandidates,
        [player, brand, number],
        [player, brand],
        [player, set],
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
  const queries = uniquePricingQueries(lookup);
  const period = opts.period ?? "30d";
  const limit = opts.limit ?? 100;
  const all: PricingRecord[] = [];
  let lastMeta: PricingSlice["rawResponseMeta"] = undefined;

  for (const q of queries) {
    const params = new URLSearchParams({ q, period, limit: String(limit) });
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
