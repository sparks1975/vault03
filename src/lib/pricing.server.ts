// Server-only 130point scraper for real SOLD comparables.
// Unofficial — no public API. Parses the sales search results page.
import type { CardDescriptor } from "./ebay.server";
import { buildQuery } from "./ebay.server";

export type SoldComp = {
  title: string;
  price: number;
  currency: string;
  soldAt: string | null;
  url: string | null;
  image: string | null;
};

type CacheEntry = { at: number; comps: SoldComp[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseRows(html: string): SoldComp[] {
  const comps: SoldComp[] = [];
  // 130point renders each sale as a <tr> or a card block. We look for anchors to eBay item pages
  // and pull the surrounding block for price/date/title/image.
  const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) ?? [];
  for (const row of rows) {
    const linkMatch = row.match(
      /href=["'](https?:\/\/(?:www\.)?ebay\.com\/[^"']+)["']/i,
    );
    const priceMatch = row.match(/\$([\d,]+(?:\.\d{1,2})?)/);
    if (!linkMatch || !priceMatch) continue;
    const url = linkMatch[1];
    const price = Number(priceMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    const titleMatch =
      row.match(/<a[^>]*href=["']https?:\/\/(?:www\.)?ebay\.com[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : "";
    const imgMatch = row.match(/<img[^>]+src=["']([^"']+)["']/i);
    // Date: try to find something like "Jun 12, 2025" or "2025-06-12"
    const dateMatch =
      row.match(/\b\d{4}-\d{2}-\d{2}\b/) ||
      row.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i);
    comps.push({
      title,
      price,
      currency: "USD",
      soldAt: dateMatch ? new Date(dateMatch[0]).toISOString() : null,
      url,
      image: imgMatch ? imgMatch[1] : null,
    });
  }
  return comps;
}

export async function fetch130PointSales(
  input: CardDescriptor,
  opts: { limit?: number } = {},
): Promise<{ query: string; comps: SoldComp[]; error?: string }> {
  const q = buildQuery(input);
  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { query: q, comps: cached.comps.slice(0, opts.limit ?? 10) };
  }
  try {
    // 130point's public sales search accepts a POST form with `query` and `type`.
    const body = new URLSearchParams({ query: q, type: "1", subcat: "-1" });
    const res = await fetch("https://back.130point.com/sales/", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://130point.com/sales/",
        Origin: "https://130point.com",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      return { query: q, comps: [], error: `130point request failed: ${res.status}` };
    }
    const html = await res.text();
    const comps = parseRows(html);
    if (comps.length === 0) {
      return { query: q, comps: [], error: "No 130point results parsed for this query." };
    }
    cache.set(q, { at: Date.now(), comps });
    return { query: q, comps: comps.slice(0, opts.limit ?? 10) };
  } catch (err) {
    return {
      query: q,
      comps: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
