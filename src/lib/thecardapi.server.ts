// Sold-comp source: thecardapi.com REST market API (Builder tier).
// This is the only sold-listing source; Apify/eBay scraping was removed.
//
// SERVER-ONLY module — never import from client code.
export type SoldSale = {
  title: string | null;
  image_url: string | null;
  price: number;
  sold_at: string | null; // ISO date (YYYY-MM-DD) if parseable
  listing_type: "fixed" | "auction" | "best_offer" | "other";
  url: string | null;
};

// Must be the www host: thecardapi.com 307-redirects every API path.
const BASE_URL = "https://www.thecardapi.com/api/v1/market";

export type TheCardApiResult = {
  sales: SoldSale[];
  raw_count: number;
  query: string;
};

type SaleRow = {
  title?: string | null;
  price?: number | string | null;
  currency?: string | null;
  sale_date?: string | null;
  sold_at?: string | null;
  listing_url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  listing_type?: string | null;
  sport?: string | null;
};

function listingType(raw: string | null | undefined): SoldSale["listing_type"] {
  const v = (raw ?? "").toLowerCase();
  if (v.includes("auction")) return "auction";
  if (v.includes("best")) return "best_offer";
  if (v.includes("fixed")) return "fixed";
  return "other";
}

// Their full-text search supports -term / -(a,b) exclusions, so drop the
// obvious non-single-card noise at the source.
const EXCLUSIONS = "-(lot,lots,box,boxes,break,case,reprint,custom,digital)";

export function buildTheCardApiQuery(descriptor: string): string {
  const cleaned = descriptor.replace(/[#]/g, " ").replace(/\s+/g, " ").trim();
  return `${cleaned} ${EXCLUSIONS}`.trim();
}

function headerInt(res: Response, names: string[]): number | null {
  for (const n of names) {
    const v = res.headers.get(n);
    if (v != null && v !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

// Usage telemetry: one row per outbound market request so the dashboard can
// report request volume and the remaining daily allowance.
async function logUsage(row: {
  endpoint: string;
  query: string;
  ok: boolean;
  status: number | null;
  result_count: number | null;
  raw_count: number | null;
  duration_ms: number;
  daily_limit: number | null;
  remaining: number | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("api_usage_events").insert({ provider: "thecardapi", ...row });
  } catch (err) {
    console.error("[thecardapi] usage log failed:", err);
  }
}

export async function searchTheCardApiSales(
  descriptor: string,
  opts: { limit?: number } = {},
): Promise<TheCardApiResult> {
  const key = process.env["THECARDAPI_API_KEY"];
  if (!key) throw new Error("THECARDAPI_API_KEY is not configured");

  const query = buildTheCardApiQuery(descriptor);
  // No `category` filter: their category column is only populated for recent
  // eBay rows, so category=sports silently returns zero results for everything.
  // Sport is filtered below, on the rows that actually carry it.
  const params = new URLSearchParams({
    q: query,
    limit: String(opts.limit ?? 50),
    sort: "date_desc",
  });

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/sales?${params.toString()}`, {
      headers: { "x-market-api-key": key, Accept: "application/json" },
    });
  } catch (err) {
    await logUsage({
      endpoint: "market/sales",
      query,
      ok: false,
      status: null,
      result_count: null,
      raw_count: null,
      duration_ms: Date.now() - startedAt,
      daily_limit: null,
      remaining: null,
    });
    throw err;
  }

  const dailyLimit = headerInt(res, ["x-ratelimit-limit", "x-rate-limit-limit", "ratelimit-limit"]);
  const remaining = headerInt(res, ["x-ratelimit-remaining", "x-rate-limit-remaining", "ratelimit-remaining"]);

  if (!res.ok) {
    const text = await res.text();
    await logUsage({
      endpoint: "market/sales",
      query,
      ok: false,
      status: res.status,
      result_count: null,
      raw_count: null,
      duration_ms: Date.now() - startedAt,
      daily_limit: dailyLimit,
      remaining,
    });
    throw new Error(`thecardapi sales search failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { data?: SaleRow[]; pagination?: { total?: number } };
  const rows = (Array.isArray(payload.data) ? payload.data : []).filter(
    (row) => !row.sport || /baseball/i.test(row.sport),
  );

  const sales: SoldSale[] = [];
  for (const row of rows) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const currency = (row.currency ?? "USD").toUpperCase();
    if (currency !== "USD") continue;
    const soldRaw = row.sale_date ?? row.sold_at ?? null;
    const sold = soldRaw ? new Date(soldRaw) : null;
    sales.push({
      title: (row.title ?? "").trim() || null,
      image_url: row.image_url ?? row.thumbnail_url ?? null,
      price,
      sold_at: sold && !Number.isNaN(sold.getTime()) ? sold.toISOString().slice(0, 10) : null,
      listing_type: listingType(row.listing_type),
      url: row.listing_url ?? null,
    });
  }
  console.log(`[thecardapi] q="${query}" raw=${rows.length} kept=${sales.length}`);
  await logUsage({
    endpoint: "market/sales",
    query,
    ok: true,
    status: res.status,
    result_count: sales.length,
    raw_count: rows.length,
    duration_ms: Date.now() - startedAt,
    daily_limit: dailyLimit,
    remaining,
  });
  return { sales, raw_count: rows.length, query };
}

