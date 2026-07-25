// 130point.com scraper via Firecrawl. 130point renders sold-listings search
// entirely client-side, so we drive it with Firecrawl actions: type into the
// #searchBar input, press Enter, wait for results, then parse the markdown.
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
    /\[!\[([^\]]*)\][\s\S]*?\$([\d,]+(?:\.\d+)?)\s*USD[\s\S]*?(Fixed Price|Auction|Best Offer)[\s\S]*?(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}(?:\s+\d{1,2}:\d{2}:\d{2})?)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(markdown)) !== null) {
    const [, title, priceStr, typeStr, dateStr, url] = m;
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
  const parts = [
    fields.year ? String(fields.year) : null,
    fields.set_name,
    fields.player_name,
    includeCardNumber && fields.card_number ? `#${String(fields.card_number).replace(/^#/, "")}` : null,
    fields.is_autograph ? "auto" : null,
    parallel,
    fields.grader && fields.grade ? `${fields.grader} ${fields.grade}` : fields.grade ?? null,
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
    url: "https://130point.com/sales/",
    formats: ["markdown"],
    onlyMainContent: true,
    waitFor: 5000,
    actions: [
      { type: "wait", milliseconds: 3000 },
      { type: "write", selector: "#searchBar", text: descriptor },
      { type: "press", key: "Enter" },
      { type: "wait", milliseconds: 8000 },
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
  const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
  const md = json?.data?.markdown ?? "";
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
