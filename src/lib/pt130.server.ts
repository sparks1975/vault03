// 130point.com scraper via Firecrawl. 130point renders sold-listings search
// entirely client-side, so we drive it with Firecrawl actions: type into the
// current search input, submit, wait for results, then parse the markdown.
//
// SERVER-ONLY module — never import from client code.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/firecrawl/v2/scrape";

export type Pt130Sale = {
  title: string | null;
  price: number;
  sold_at: string | null; // ISO date (YYYY-MM-DD) if parseable
  listing_type: "fixed" | "auction" | "best_offer" | "other";
  url: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function normalizeListingType(raw: string): Pt130Sale["listing_type"] {
  const n = raw.trim().toLowerCase();
  if (n.startsWith("fixed")) return "fixed";
  if (n.startsWith("auction")) return "auction";
  if (n.startsWith("best")) return "best_offer";
  return "other";
}

// "16 Jul 26 04:00:08" -> ISO YYYY-MM-DD (year assumed 20xx).
function parseSoldDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const monthName = m[2].toLowerCase();
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const mi = months.indexOf(monthName);
  if (mi < 0) return null;
  const d = new Date(Date.UTC(year, mi, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parsePt130Markdown(markdown: string): Pt130Sale[] {
  const out: Pt130Sale[] = [];
  const pattern =
    /\[!\[([^\]]*)\]([\s\S]*?)(Fixed Price|Auction|Best Offer)(?: Accepted)?[\s\S]*?(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}(?:\s+\d{1,2}:\d{2}:\d{2})?)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(markdown)) !== null) {
    const [, title, listingBody, typeStr, dateStr, url] = m;
    const priceMatches = [...listingBody.matchAll(/\$([\d,]+(?:\.\d+)?)\s*USD/g)];
    // Best-offer rows show the original asking price first and the accepted
    // sale price second. The last amount is the actual completed-sale value.
    const priceStr = priceMatches.at(-1)?.[1] ?? "";
    const price = Number(priceStr.replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    out.push({
      title: title.trim() || null,
      price,
      sold_at: parseSoldDate(dateStr),
      listing_type: normalizeListingType(typeStr),
      url,
    });
  }
  return out;
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
  // Grader/grade intentionally excluded — including them narrows 130point
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
    // Hyphens are treated as an exclusion operator by the eBay-backed search
    // behind 130point ("112-SP" => 112 NOT SP), which silently drops every
    // legitimate short-print listing. Render the number with spaces instead.
    includeCardNumber && fields.card_number
      ? `#${String(fields.card_number).replace(/^#/, "").replace(/[-/]+/g, " ").replace(/\s+/g, " ").trim()}`
      : null,
  ].filter(Boolean) as string[];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}


export function buildPt130Descriptors(fields: Parameters<typeof buildPt130Descriptor>[0]): string[] {
  const primary = buildPt130Descriptor(fields, { includeCardNumber: true });
  const withoutNumber = fields.card_number
    ? buildPt130Descriptor(fields, { includeCardNumber: false })
    : "";
  return [primary, withoutNumber].filter((value, index, all) => value && all.indexOf(value) === index);
}

export async function scrapePt130(descriptor: string): Promise<Pt130Sale[]> {
  const lovableKey = requireEnv("LOVABLE_API_KEY");
  const firecrawlKey = requireEnv("FIRECRAWL_API_KEY");
  if (!descriptor.trim()) return [];

  const body = {
    url: "https://130point.com/search",
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 4000,
    actions: [
      { type: "wait", milliseconds: 2500 },
      { type: "click", selector: 'input[placeholder="Search by player, set, year, etc"]' },
      { type: "write", text: descriptor },
      { type: "press", key: "Enter" },
      { type: "wait", milliseconds: 6000 },
    ],
  };

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": firecrawlKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl 130point scrape failed [${res.status}]: ${text}`);
  }
  const json = (await res.json()) as {
    success?: boolean;
    data?: { markdown?: string; metadata?: { url?: string } };
  };
  const md = json?.data?.markdown ?? "";
  // The retired /sales route redirects to the homepage with HTTP 200, whose
  // featured auctions resemble search results. Reject that page and the new
  // /search empty state so unrelated listings can never enter the comp cache.
  const renderedUrl = json?.data?.metadata?.url ?? "";
  const isSearchPage = renderedUrl ? new URL(renderedUrl).pathname === "/search" : true;
  const isEmptySearch = md.includes("Try searching for a collectible!");
  if (!isSearchPage || isEmptySearch) {
    console.error("130point search did not submit; rejecting non-result listings");
    return [];
  }
  return parsePt130Markdown(md);
}

// Replace this card's cached comps with a fresh scrape. Returns rows stored.
export async function refreshPt130ForCard(
  supabase: {
    from: (t: string) => {
      delete: () => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
      insert: (rows: unknown[]) => Promise<{ error: unknown }>;
    };
  },
  args: {
    card_id: string;
    user_id: string;
    descriptor: string | string[];
    card_number?: string | null;
  },
): Promise<{ stored: number; scraped: number }> {
  const descriptors = Array.isArray(args.descriptor) ? args.descriptor : [args.descriptor];
  const sales: Pt130Sale[] = [];
  const seen = new Set<string>();
  let scraped = 0;
  for (const descriptor of descriptors) {
    const trimmed = descriptor.trim();
    if (!trimmed) continue;
    const attempt = await scrapePt130(trimmed);
    scraped += attempt.length;
    for (const sale of attempt) {
      const key = [sale.url, sale.title, sale.sold_at, sale.price].map((value) => String(value ?? "")).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      sales.push(sale);
    }
    // Search descriptors are ordered most-specific first. Only stop early when
    // the specific query actually produced listings carrying this card number —
    // otherwise fall through to the broader descriptor.
    const numberToken = args.card_number
      ? String(args.card_number).replace(/[^a-z0-9]/gi, "").toLowerCase()
      : "";
    const hasNumberMatch = !numberToken
      ? sales.length > 0
      : sales.some((s) => String(s.title ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase().includes(numberToken));
    if (hasNumberMatch) break;
  }
  const del = await supabase.from("pt130_comps").delete().eq("card_id", args.card_id);
  if (del.error) throw del.error;
  if (sales.length === 0) return { stored: 0, scraped: 0 };
  const rows = sales.map((s) => ({
    card_id: args.card_id,
    user_id: args.user_id,
    sold_at: s.sold_at,
    price: s.price,
    title: s.title,
    url: s.url,
    listing_type: s.listing_type,
  }));
  const ins = await supabase.from("pt130_comps").insert(rows);
  if (ins.error) throw ins.error;
  return { stored: rows.length, scraped };
}
