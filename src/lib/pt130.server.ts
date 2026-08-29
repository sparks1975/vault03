// eBay completed-sales comps via Apify (actor: memo23/ebay-search-scraper-ppe).
// Cheapest actor that actually returns sold listings today: $0.003 per sold row
// ("fast-item" event) with no per-result markup, so a 15-result pull costs
// ~$0.045 per card. The previous caffein.dev actor billed $0.004/result AND is
// currently blocked by eBay (every run returns 0 items), as are the $0.002
// actors from sync-network and tnodes.
// The cache table is still named pt130_comps for backward compatibility.
//
// SERVER-ONLY module — never import from client code.
import { cardSetBrand, toApprovedCardSet } from "./card-sets";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/apify";
const ACTOR_ID = "memo23~ebay-search-scraper-ppe";
const RESULTS_PER_SEARCH = 40; // 15 was starving the comp pool before verification
const BASEBALL_CARDS_CATEGORY = "26376"; // eBay Baseball Cards — filters boxes/lots at the source
// Japanese brands are often listed outside the US Baseball Cards category, so
// locking _sacat=26376 hides the sold rows that actually exist.
const SKIP_EBAY_CATEGORY_RE = /\b(bbm|epoch|calbee)\b/i;

export function ebaySoldSearchUrl(keyword: string): string {
  return ebaySoldSearchUrls(keyword)[0];
}

export function ebaySoldSearchUrls(keyword: string): string[] {
  const base =
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}` +
    `&LH_Sold=1&LH_Complete=1&_sop=13`;
  const withCategory = `${base}&_sacat=${BASEBALL_CARDS_CATEGORY}`;
  // Japanese brands: try the open sold search first (how 130point finds them),
  // and keep the US Baseball Cards URL as a second shot.
  if (SKIP_EBAY_CATEGORY_RE.test(keyword)) return [base, withCategory];
  return [withCategory];
}

export type Pt130Sale = {
  title: string | null;
  image_url: string | null;
  price: number;
  sold_at: string | null; // ISO date (YYYY-MM-DD) if parseable
  listing_type: "fixed" | "auction" | "best_offer" | "other";
  url: string | null;
};

type ApifyEbayItem = {
  title?: string | null;
  price?: string | null;
  priceValue?: number | string | null;
  currency?: string | null;
  soldDate?: string | null; // e.g. "Sold  Aug 18, 2026"
  sold?: boolean | null;
  url?: string | null;
  image?: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function normalizeListingType(
  raw: string | null | undefined,
  isBestOffer: boolean | null | undefined,
): Pt130Sale["listing_type"] {
  // caffein.dev sets isBestOfferAccepted=true for Best Offer sales regardless
  // of the underlying listingType, so check it first.
  if (isBestOffer) return "best_offer";
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (v.includes("auction")) return "auction";
  if (v.includes("buyitnow") || v.includes("fixed")) return "fixed";
  return "other";
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}


export function buildPt130Descriptor(fields: {
  year?: string | number | null;
  set_name?: string | null;
  player_name?: string | null;
  card_number?: string | null;
  is_autograph?: boolean | null;
  selected_parallel_name?: string | null;
  serial_number?: string | null;
  grader?: string | null;
  grade?: string | null;
}, opts: { includeCardNumber?: boolean; setLabel?: "brand" | "set"; includeTraits?: boolean } = {}): string {
  const includeCardNumber = opts.includeCardNumber ?? true;
  const includeTraits = opts.includeTraits ?? false;
  // Sold-search discovery must state the same value-affecting traits that the
  // verification pass later requires, otherwise autographed / parallel /
  // serial-numbered cards search as base cards and every returned listing gets
  // rejected ("0 recent comparables"). Grades are intentionally left out: the
  // verifier never checks them and graders/grades are written inconsistently.
  void fields.grader;
  void fields.grade;
  const parallel = (fields.selected_parallel_name ?? "")
    .replace(/\/\s*\d+/g, " ")
    .replace(/\b(parallel|card|cards)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const serialDenominator =
    (fields.serial_number ?? "").match(/\/\s*(\d+)/)?.[1] ??
    (fields.selected_parallel_name ?? "").match(/\/\s*(\d+)/)?.[1] ??
    null;
  // Brand and set are searched independently: the set-specific query finds the
  // exact release, the brand-only query catches sellers who list just "Topps".
  // Never put the raw catalog string in the query — subset names like
  // "Bowman Chrome Sapphire Prospects Image Variation" match nothing on eBay.
  // Use the approved product name (Bowman Chrome) instead.
  const setLabel =
    opts.setLabel === "set"
      ? (toApprovedCardSet(fields.set_name) ??
          ((fields.set_name ?? "").replace(/\s+/g, " ").trim() || cardSetBrand(fields.set_name)))
      : cardSetBrand(fields.set_name);
  const parts = [
    fields.year ? String(fields.year) : null,
    setLabel,
    // eBay treats a hyphen as an exclusion operator ("112-SP" => 112 NOT SP),
    // which silently drops every legitimate short-print listing. Render the
    // number with spaces instead.
    includeCardNumber && fields.card_number
      ? `#${String(fields.card_number).replace(/^#/, "").replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim()}`
      : null,
    fields.player_name,
    includeTraits ? parallel || null : null,
    includeTraits && serialDenominator ? `/${serialDenominator}` : null,
    includeTraits && fields.is_autograph ? "auto" : null,
  ].filter(Boolean) as string[];
  return parts.join(" ").replace(/\s+/g, " ").trim();

}

// Search tiers, run on demand so cost only grows when comps are missing:
//  1. year + product + card number + player (+ auto/parallel traits)
//  2. year + brand + card number + player      (fewer than 8 verified comps)
//  3. year + product + player, no card number  (fewer than 5 verified comps)
export function buildPt130SearchTiers(
  fields: Parameters<typeof buildPt130Descriptor>[0],
): { primary: string; brand: string | null; noNumber: string | null } {
  const primary = buildPt130Descriptor(fields, { includeCardNumber: true, setLabel: "set" });
  const brand = buildPt130Descriptor(fields, { includeCardNumber: true, setLabel: "brand" });
  const noNumber = buildPt130Descriptor(fields, { includeCardNumber: false, setLabel: "set" });
  return {
    primary,
    brand: brand && brand !== primary ? brand : null,
    noNumber: noNumber && noNumber !== primary ? noNumber : null,
  };
}

export function buildPt130Descriptors(fields: Parameters<typeof buildPt130Descriptor>[0]): string[] {
  const tiers = buildPt130SearchTiers(fields);
  return [tiers.primary, tiers.brand].filter((d): d is string => Boolean(d));
}


// Run the Apify eBay sold-listings actor for one or more search keywords.
// Each keyword becomes one sold-search URL; maxItems is applied per search, so
// keep the descriptor list to one or two entries to control cost.
export async function scrapePt130(descriptor: string | string[]): Promise<Pt130Sale[]> {
  const lovableKey = requireEnv("LOVABLE_API_KEY");
  const apifyKey = requireEnv("APIFY_API_KEY");

  const keywords = (Array.isArray(descriptor) ? descriptor : [descriptor])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (keywords.length === 0) return [];
  const startUrls: Array<{ url: string }> = [];
  for (const keyword of keywords) {
    for (const url of ebaySoldSearchUrls(keyword)) {
      if (startUrls.length >= 2) break;
      startUrls.push({ url });
    }
    if (startUrls.length >= 2) break;
  }

  const headers = {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": apifyKey,
    "Content-Type": "application/json",
  };
  const input = {
    // Sold search URLs (LH_Sold/LH_Complete) scoped to Baseball Cards, sorted
    // by most recently ended.
    startUrls,
    mode: "sold",
    detailedItems: false, // sold rows come from search results; avoids 3x request cost
    maxItems: RESULTS_PER_SEARCH,
    marketplace: "ebay.com",
  };

  // The connector gateway cuts requests off at ~60s, so run-sync-get-dataset-items
  // always returned 502 for runs that take longer. Start the run async and poll.
  const startRes = await fetch(`${GATEWAY_URL}/acts/${ACTOR_ID}/runs?timeout=300`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`Apify eBay sold listings failed to start [${startRes.status}]: ${text}`);
  }
  const started = (await startRes.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  const runId = started.data?.id;
  if (!runId) throw new Error("Apify eBay sold listings returned no run id");

  // The dataset id on the start payload is not reliable while the run is still
  // READY — always take it from the final run status.
  let datasetId = started.data?.defaultDatasetId ?? null;
  const deadline = Date.now() + 240_000;
  let status = "READY";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const statusRes = await fetch(`${GATEWAY_URL}/actor-runs/${runId}`, { headers });
    if (!statusRes.ok) continue;
    const body = (await statusRes.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    status = body.data?.status ?? status;
    if (body.data?.defaultDatasetId) datasetId = body.data.defaultDatasetId;
    if (status !== "RUNNING" && status !== "READY") break;
  }
  if (status !== "SUCCEEDED") {
    // Timed-out or aborted runs may still have partial results; only hard-fail
    // when nothing usable exists.
    console.warn(`Apify eBay run finished with status ${status}`);
  }
  if (!datasetId) throw new Error("Apify eBay sold listings returned no dataset");

  const itemsRes = await fetch(
    `${GATEWAY_URL}/datasets/${datasetId}/items?clean=true&limit=200`,
    { headers },
  );
  if (!itemsRes.ok) {
    const text = await itemsRes.text();
    throw new Error(`Apify eBay sold listings failed [${itemsRes.status}]: ${text}`);
  }

  const items = (await itemsRes.json()) as ApifyEbayItem[];
  if (!Array.isArray(items)) return [];

  const out: Pt130Sale[] = [];
  const dropped = { currency: 0, notSold: 0, price: 0, date: 0 };
  for (const item of items) {
    // Only USD sales — mixing currencies would corrupt the valuation math.
    if (item.currency && item.currency !== "USD") { dropped.currency++; continue; }
    // A parseable sold date is itself proof of a completed sale: the actor's
    // `sold` flag is missing on some rows even for real sales.
    const soldRaw = item.soldDate?.replace(/^sold\s*/i, "").trim() || null;
    const soldIso = toIsoDate(soldRaw);
    if (!soldIso && item.sold !== true) { dropped.notSold++; continue; }
    if (!soldIso) { dropped.date++; continue; }
    const price = Number(item.priceValue ?? String(item.price ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) { dropped.price++; continue; }
    if (new Date(soldRaw as string).getTime() > Date.now() + 24 * 60 * 60 * 1000) { dropped.date++; continue; }

    out.push({
      title: item.title?.trim() || null,
      image_url: item.image || null,
      price,
      sold_at: soldIso,
      // The sold search results do not expose buying format; the valuation math
      // treats "other" the same as any single sale.
      listing_type: normalizeListingType(null, null),
      url: item.url || null,
    });
  }

  console.log(
    `[ebay] keywords=${keywords.length} raw=${items.length} kept=${out.length} ` +
    `dropped: currency=${dropped.currency} notSold=${dropped.notSold} price=${dropped.price} date=${dropped.date}`,
  );
  return out;
}

// Replace this card's cached comps with a fresh pull. Returns rows stored.
export async function refreshPt130ForCard(
  supabase: {
    from: (t: string) => {
      delete: () => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
      insert: (rows: unknown[]) => PromiseLike<{ error: unknown }>;
    };
  },
  args: {
    card_id: string;
    user_id: string;
    descriptor: string | string[];
    card_number?: string | null;
    append?: boolean;
  },
): Promise<{ stored: number; scraped: number }> {
  const descriptors = (Array.isArray(args.descriptor) ? args.descriptor : [args.descriptor])
    .map((d) => d.trim())
    .filter(Boolean);
  const scrapedSales = await scrapePt130(descriptors);

  const seen = new Set<string>();
  const sales: Pt130Sale[] = [];
  for (const sale of scrapedSales) {
    const key = [sale.url, sale.title, sale.sold_at, sale.price].map((v) => String(v ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    sales.push(sale);
  }

  // Never wipe the cache on an empty scrape. That is how a failed Apify run
  // (or a too-narrow query) left the card with "no comps at all".
  if (sales.length === 0) return { stored: 0, scraped: scrapedSales.length };
  if (!args.append) {
    const del = await supabase.from("pt130_comps").delete().eq("card_id", args.card_id);
    if (del.error) throw del.error;
  }
  const rows = sales.map((s) => ({
    card_id: args.card_id,
    user_id: args.user_id,
    sold_at: s.sold_at,
    price: s.price,
    title: s.title,
    image_url: s.image_url,
    url: s.url,
    listing_type: s.listing_type,
  }));
  const ins = await supabase.from("pt130_comps").insert(rows);
  if (ins.error) throw ins.error;
  return { stored: rows.length, scraped: scrapedSales.length };
}
