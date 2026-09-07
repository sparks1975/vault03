// EXPERIMENTAL sold-comp source: thecardapi.com REST market API.
// Used only when a valuation is explicitly run with pricing_source="thecardapi"
// so we can compare its results against the current Apify/eBay pull without
// changing the default pipeline.
//
// SERVER-ONLY module — never import from client code.
import type { Pt130Sale } from "./pt130.server";

// Must be the www host: thecardapi.com 307-redirects every API path.
const BASE_URL = "https://www.thecardapi.com/api/v1/market";

export type TheCardApiResult = {
  sales: Pt130Sale[];
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

function listingType(raw: string | null | undefined): Pt130Sale["listing_type"] {
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

  const res = await fetch(`${BASE_URL}/sales?${params.toString()}`, {
    headers: { "x-market-api-key": key, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`thecardapi sales search failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { data?: SaleRow[]; pagination?: { total?: number } };
  const rows = (Array.isArray(payload.data) ? payload.data : []).filter(
    (row) => !row.sport || /baseball/i.test(row.sport),
  );

  const sales: Pt130Sale[] = [];
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
  return { sales, raw_count: rows.length, query };
}
