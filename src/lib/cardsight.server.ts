// Server-only Cardsight client. Uses the MCP JSON-RPC endpoint with X-API-Key.
// Do not import from client-reachable modules at top level.

const MCP_URL = "https://mcp.cardsight.ai/";

export type CardDescriptor = {
  player_name: string;
  year?: number | null;
  set_name?: string | null;
  card_number?: string | null;
  grade?: string | null;
  grader?: string | null;
  is_autograph?: boolean | null;
  serial_number?: string | null;
  parallel?: string | null;
};

export type ParallelOption = {
  id: string;
  name: string;
  printRun: string | null;
  set: string | null;
};


export type SoldComp = {
  title: string;
  price: number;
  currency: string;
  soldAt: string | null;
  url: string | null;
  source: string;
  listingType: string | null;
  grade: string | null;
};

function apiKey(): string {
  const k = process.env.CARDSIGHT_API_KEY;
  if (!k) throw new Error("CARDSIGHT_API_KEY is not configured");
  return k;
}

// Minimal MCP JSON-RPC caller. Handles both `application/json` and SSE responses.
async function mcpCall(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Cardsight ${name} failed: ${res.status} ${raw.slice(0, 200)}`);

  // SSE frames look like `event: message\ndata: {json}\n\n`. Strip the prefixes.
  const jsonText = raw.includes("data: ")
    ? raw
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("")
    : raw;

  let parsed: { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message: string } };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Cardsight ${name} returned unparseable body: ${raw.slice(0, 200)}`);
  }
  if (parsed.error) throw new Error(`Cardsight ${name}: ${parsed.error.message}`);
  const text = parsed.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  return text;
}

function buildFreeText(input: CardDescriptor): string {
  return [
    input.year,
    input.set_name,
    input.player_name,
    input.card_number ? `#${input.card_number}` : null,
    input.parallel ?? null,
    input.grader && input.grade ? `${input.grader} ${input.grade}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function parallelTokens(parallel: string): string[] {
  return parallel
    .toLowerCase()
    .replace(/\(\/\d+\)|\/\d+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}


// Parse the human-readable sold-comps block returned by `search_pricing`.
// Example row:
//   - $1300.00 (fixed) on ebay — 7/15/2026
//      "Topps 2011 Update ..."
//      → Mike Trout #US175 [card: `...`] · PSA 10
//      https://showme.cards/xxxx
function parseSoldComps(text: string): SoldComp[] {
  const comps: SoldComp[] = [];
  // Split into blocks that begin with a "- $" line.
  const blocks = text.split(/\n(?=- \$)/g);
  for (const block of blocks) {
    const header = block.match(/^- \$([\d,]+(?:\.\d{1,2})?)\s*\(([^)]+)\)\s*on\s+([^\s—-]+)\s*[—-]\s*([\d/\-]+)/);
    if (!header) continue;
    const price = Number(header[1].replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    const listingType = header[2].trim();
    const source = header[3].trim();
    const rawDate = header[4].trim();
    let soldAt: string | null = null;
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) soldAt = parsed.toISOString();

    const titleMatch = block.match(/"([^"]+)"/);
    const urlMatch = block.match(/https?:\/\/\S+/);
    const gradeMatch = block.match(/·\s*([A-Z]{2,4}\s*\d{1,2}(?:\.\d)?)/);

    comps.push({
      title: titleMatch ? titleMatch[1] : "",
      price,
      currency: "USD",
      soldAt,
      url: urlMatch ? urlMatch[0] : null,
      source,
      listingType,
      grade: gradeMatch ? gradeMatch[1].trim() : null,
    });
  }
  return comps;
}

const cache = new Map<string, { at: number; comps: SoldComp[] }>();
const TTL_MS = 10 * 60 * 1000;

const NO_RESULTS_RE =
  /no.*sold comps|no recent sales|no completed[- ]sale listings|no results|no listings/i;

async function runSearchPricing(
  q: string,
  period: string,
  limit: number,
): Promise<{ comps: SoldComp[]; empty: boolean; raw: string }> {
  const text = await mcpCall("search_pricing", { q, period, limit });
  if (NO_RESULTS_RE.test(text)) return { comps: [], empty: true, raw: text };
  const comps = parseSoldComps(text);
  return { comps, empty: comps.length === 0, raw: text };
}

// Signals that a listing is a NON-base variant (parallel, insert, refractor,
// serialized, or a hit like an auto/patch/relic). We match with word-boundaries
// on colors to avoid false positives inside URLs or set names like "Topps Chrome".
const AUTO_KEYWORDS = ["auto", "autograph", "autographed", "signed", "signature"];
const RELIC_KEYWORDS = ["patch", "relic", "jersey", "rpa", "logoman", "letterman"];
const PARALLEL_COLOR_WORDS = [
  "refractor", "prizm", "mojo", "wave", "rainbow", "atomic", "superfractor",
  "sapphire", "emerald", "ruby", "onyx",
  "gold", "silver", "black", "red", "blue", "orange", "purple", "pink", "green",
  "bronze", "camo", "shimmer", "holo", "xfractor", "disco", "lava", "mini-diamond",
];
const OTHER_PARALLEL_WORDS = [
  "ssp", "short print", "insert", "parallel", "variation", "printing plate",
  "1/1", "one of one", "numbered to", "case hit", "die-cut", "die cut",
];

function hasSerialSignal(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  if (/\s\/\s?\d{1,4}\b/.test(t)) return true;   // "/99", " /25"
  if (/#\d+\/\d+/.test(t)) return true;           // "#12/25"
  if (/\bnumbered\b/.test(t)) return true;
  return false;
}

function hasAutoSignal(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  return AUTO_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(t));
}

function hasRelicSignal(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  return RELIC_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(t));
}

function hasParallelColorSignal(text: string): boolean {
  const t = text.toLowerCase();
  // Only match as whole words to avoid substrings like "gold" inside URLs.
  if (PARALLEL_COLOR_WORDS.some((k) => new RegExp(`\\b${k}\\b`).test(t))) return true;
  if (OTHER_PARALLEL_WORDS.some((k) => t.includes(k))) return true;
  return false;
}

function filterAndRankComps(comps: SoldComp[], input: CardDescriptor): SoldComp[] {
  const setLc = (input.set_name ?? "").toLowerCase();
  // Words already implied by the user's set name shouldn't be treated as parallel
  // signals in comp titles (e.g. base "Topps Chrome" contains "chrome").
  const setImpliedColors = PARALLEL_COLOR_WORDS.filter((w) =>
    new RegExp(`\\b${w}\\b`).test(setLc),
  );
  const stripImplied = (text: string): string => {
    let out = text.toLowerCase();
    for (const w of setImpliedColors) out = out.replace(new RegExp(`\\b${w}\\b`, "g"), "");
    return out;
  };

  const wantAuto = !!input.is_autograph;
  const wantSerial = !!(input.serial_number && input.serial_number.trim().length > 0);
  const wantParallelTokens = input.parallel ? parallelTokens(input.parallel) : [];
  const wantParallel = wantParallelTokens.length > 0;

  let filtered = comps.filter((c) => {
    const cleaned = stripImplied(c.title);
    const auto = hasAutoSignal(cleaned);
    const relic = hasRelicSignal(cleaned);
    const serial = hasSerialSignal(cleaned);
    const parallel = hasParallelColorSignal(cleaned);

    // If the user picked a specific parallel, require every token from the
    // parallel name to appear in the comp title. This keeps e.g. "Blue
    // Refractor" comps out of a plain "Refractor" pick, and vice versa.
    if (wantParallel) {
      const titleLc = c.title.toLowerCase();
      for (const tok of wantParallelTokens) {
        if (!new RegExp(`\\b${tok}\\b`).test(titleLc)) return false;
      }
      if (wantAuto && !auto) return false;
      if (!wantAuto && auto) return false;
      if (relic) return false;
      return true;
    }

    // If the user's card is base (no auto, no serial), reject any listing that
    // looks like a hit, parallel, or serialized variant.
    if (!wantAuto && !wantSerial) {
      if (auto || relic || serial || parallel) return false;
      return true;
    }
    // If the user's card is an autograph, require the comp to be an auto.
    if (wantAuto && !auto) return false;
    // If it's a base auto (not serialized), still exclude serialized/patch/parallel autos.
    if (wantAuto && !wantSerial && (serial || relic || parallel)) return false;
    // If the user's card is serialized, require a serial signal in the comp.
    if (wantSerial && !serial) return false;
    return true;
  });

  // Grade match: prefer exact grade matches when we have enough.
  if (input.grade) {
    const wantGrade = `${input.grader ?? ""} ${input.grade}`.trim().toLowerCase();
    const gradeMatches = filtered.filter((c) => {
      const g = (c.grade ?? "").toLowerCase();
      const t = c.title.toLowerCase();
      return (g && (g === wantGrade || g.includes(input.grade!.toLowerCase()))) ||
        t.includes(wantGrade);
    });
    if (gradeMatches.length >= 3) filtered = gradeMatches;
  } else {
    const raw = filtered.filter((c) => !c.grade && !/\b(psa|bgs|sgc|cgc)\b/i.test(c.title));
    if (raw.length >= 3) filtered = raw;
  }

  // Trim outliers using IQR so a single mispriced listing doesn't skew the median.
  if (filtered.length >= 5) {
    const sorted = [...filtered].sort((a, b) => a.price - b.price);
    const q = (p: number) => sorted[Math.floor((sorted.length - 1) * p)].price;
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const trimmed = filtered.filter((c) => c.price >= lo && c.price <= hi);
    if (trimmed.length >= 3) filtered = trimmed;
  }

  return filtered;
}

export async function fetchCardsightSoldComps(
  input: CardDescriptor,
  opts: { limit?: number; period?: string } = {},
): Promise<{ query: string; comps: SoldComp[]; error?: string }> {
  const period = opts.period ?? "3m";
  const limit = opts.limit ?? 25;

  // Try progressively broader queries so uncommon cards still surface comps.
  const queries: string[] = [];
  const full = buildFreeText(input);
  if (full) queries.push(full);
  const noGrade = buildFreeText({ ...input, grade: null, grader: null });
  if (noGrade && !queries.includes(noGrade)) queries.push(noGrade);
  const noNumber = buildFreeText({ ...input, grade: null, grader: null, card_number: null });
  if (noNumber && !queries.includes(noNumber)) queries.push(noNumber);
  const nameYear = [input.year, input.player_name].filter(Boolean).join(" ");
  if (nameYear && !queries.includes(nameYear)) queries.push(nameYear);
  if (queries.length === 0) queries.push(input.player_name);

  const primary = queries[0];
  const variantKey = `${input.is_autograph ? "auto" : ""}${input.serial_number ? "|#" : ""}`;
  const cacheKey = `${primary}|${period}|${limit}|${variantKey}|filtered-v2`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { query: primary, comps: cached.comps };
  }

  let lastRaw = "";
  for (const q of queries) {
    try {
      const { comps, empty, raw } = await runSearchPricing(q, period, limit);
      lastRaw = raw;
      if (empty || comps.length === 0) continue;
      const filtered = filterAndRankComps(comps, input);
      // Do NOT fall back to unfiltered comps — that pollutes base card comps
      // with parallel/auto/serialized variants and inflates the range.
      if (filtered.length === 0) continue;
      cache.set(cacheKey, { at: Date.now(), comps: filtered });
      return { query: q, comps: filtered };
    } catch (err) {
      return {
        query: q,
        comps: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  console.log("Cardsight search_pricing had no matching comps. Last response:", lastRaw?.slice(0, 300));
  return {
    query: primary,
    comps: [],
    error: "No matching sold comps for this exact card variant.",
  };
}


// Call Cardsight's identify_card with a public https image URL. Returns raw
// human-readable text so the caller can feed it into an LLM structurer.
export async function identifyCardFromImageUrl(
  imageUrl: string,
): Promise<{ text: string; error?: string }> {
  try {
    const text = await mcpCall("identify_card", { imageUrl });
    if (/identification failed|invalid input|expected.*imageUrl|received undefined/i.test(text)) {
      return { text: "", error: text };
    }
    return { text };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : String(err) };
  }
}
