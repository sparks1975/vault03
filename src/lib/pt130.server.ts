// eBay completed-sales comps via Apify (actor: caffein.dev/ebay-sold-listings).
// The actor is paid per result (~$2.50–$4 / 1,000 results), so we keep
// `count` low (20) and send a single descriptor per card to minimize cost.
// The cache table is still named pt130_comps for backward compatibility.
//
// SERVER-ONLY module — never import from client code.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/apify";
const ACTOR_ID = "caffein.dev~ebay-sold-listings";
const DAYS_TO_SCRAPE = 90; // actor maximum
const RESULTS_PER_SEARCH = 20; // keeps cost ~$0.05–$0.08 per card

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
  soldPrice?: string | number | null;
  soldCurrency?: string | null;
  endedAt?: string | null;
  url?: string | null;
  listingType?: string | null;
  isBestOfferAccepted?: boolean | null;
  thumbnailUrl?: string | null;
  keyword?: string | null;
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
  grader?: string | null;
  grade?: string | null;
}, opts: { includeCardNumber?: boolean } = {}): string {
  const includeCardNumber = opts.includeCardNumber ?? true;
  const parallel = fields.selected_parallel_name
    ? fields.selected_parallel_name.replace(/\/\s*\d+/g, " ").replace(/\s+/g, " ").trim()
    : null;
  // Grader/grade intentionally excluded — including them narrows the sold
  // search too aggressively (especially for niche graders like Arena Club).
  // We keep them as inputs so the API signature is stable.
  void fields.grader;
  void fields.grade;
  const parts = [
    fields.year ? String(fields.year) : null,
    fields.set_name,
    fields.player_name,
    fields.is_autograph ? "auto" : null,
    parallel,
    // eBay treats a hyphen as an exclusion operator ("112-SP" => 112 NOT SP),
    // which silently drops every legitimate short-print listing. Render the
    // number with spaces instead.
    includeCardNumber && fields.card_number
      ? `#${String(fields.card_number).replace(/^#/, "").replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim()}`
      : null,
  ].filter(Boolean) as string[];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// Returns only the primary descriptor (with card number) to keep result count
// — and therefore Apify cost — as low as possible.
export function buildPt130Descriptors(fields: Parameters<typeof buildPt130Descriptor>[0]): string[] {
  const primary = buildPt130Descriptor(fields, { includeCardNumber: true });
  return primary ? [primary] : [];
}

// Run the Apify eBay sold-listings actor for one or more search keywords.
// The actor accepts up to 6 keywords per run, so all descriptors for a card are
// searched in a single run.
export async function scrapePt130(descriptor: string | string[]): Promise<Pt130Sale[]> {
  const lovableKey = requireEnv("LOVABLE_API_KEY");
  const apifyKey = requireEnv("APIFY_API_KEY");

  const keywords = (Array.isArray(descriptor) ? descriptor : [descriptor])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (keywords.length === 0) return [];

  const res = await fetch(
    `${GATEWAY_URL}/acts/${ACTOR_ID}/run-sync-get-dataset-items?timeout=180`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": apifyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keywords,
        count: RESULTS_PER_SEARCH,
        daysToScrape: DAYS_TO_SCRAPE,
        ebaySite: "ebay.com",
        sortOrder: "endedRecently",
        categoryId: "26376", // eBay Baseball Cards — filters boxes/lots/non-baseball at the source
        includeCompletedListings: true,
        itemCondition: "any",
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify eBay sold listings failed [${res.status}]: ${text}`);
  }

  const items = (await res.json()) as ApifyEbayItem[];
  if (!Array.isArray(items)) return [];

  const out: Pt130Sale[] = [];
  for (const item of items) {
    // Only USD sales — mixing currencies would corrupt the valuation math.
    if (item.soldCurrency && item.soldCurrency !== "USD") continue;
    const price = Number(item.soldPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    // Sold-only: a completed sale always has an end date in the past. Anything
    // missing or future-dated is an active listing and must never be a comp.
    const endedIso = toIsoDate(item.endedAt);
    if (!endedIso) continue;
    if (new Date(item.endedAt as string).getTime() > Date.now() + 24 * 60 * 60 * 1000) continue;

    out.push({
      title: item.title?.trim() || null,
      image_url: item.thumbnailUrl || null,
      price,
      sold_at: endedIso,
      listing_type: normalizeListingType(item.listingType, item.isBestOfferAccepted),
      url: item.url || null,
    });
  }

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

  const del = await supabase.from("pt130_comps").delete().eq("card_id", args.card_id);
  if (del.error) throw del.error;
  if (sales.length === 0) return { stored: 0, scraped: scrapedSales.length };
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
