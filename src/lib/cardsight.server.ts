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
    input.grader && input.grade ? `${input.grader} ${input.grade}` : null,
  ]
    .filter(Boolean)
    .join(" ");
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

export async function fetchCardsightSoldComps(
  input: CardDescriptor,
  opts: { limit?: number; period?: string } = {},
): Promise<{ query: string; comps: SoldComp[]; error?: string }> {
  const period = opts.period ?? "3m";
  const limit = opts.limit ?? 10;

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
  const cacheKey = `${primary}|${period}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { query: primary, comps: cached.comps };
  }

  let lastRaw = "";
  for (const q of queries) {
    try {
      const { comps, empty, raw } = await runSearchPricing(q, period, limit);
      lastRaw = raw;
      if (!empty && comps.length > 0) {
        cache.set(cacheKey, { at: Date.now(), comps });
        return { query: q, comps };
      }
    } catch (err) {
      return {
        query: q,
        comps: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  console.log("Cardsight search_pricing had no comps. Last response:", lastRaw?.slice(0, 300));
  return {
    query: primary,
    comps: [],
    error: "Cardsight has no recent sold comps for this card.",
  };
}


// Call Cardsight's identify_card with a public https image URL. Returns raw
// human-readable text so the caller can feed it into an LLM structurer.
export async function identifyCardFromImageUrl(
  imageUrl: string,
): Promise<{ text: string; error?: string }> {
  try {
    const text = await mcpCall("identify_card", { image_url: imageUrl });
    return { text };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : String(err) };
  }
}
