// Server-only helpers to fetch open-graph preview metadata for comp URLs.
// Used by the Manage Comps dialog to display an image + description for
// each candidate listing.

export type CompPreview = {
  url: string;
  image: string | null;
  title: string | null;
  description: string | null;
};

const previewCache = new Map<string, { at: number; value: CompPreview }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function extractMeta(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const raw = m[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
      if (raw) return raw;
    }
  }
  return null;
}

async function fetchOne(url: string, signal: AbortSignal): Promise<CompPreview> {
  const empty: CompPreview = { url, image: null, title: null, description: null };
  try {
    const res = await fetch(url, {
      signal,
      redirect: "follow",
      headers: {
        // eBay serves fuller OG metadata to browser-like UAs.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return empty;
    // Only read the first ~120KB — OG tags are always in <head>.
    const reader = res.body?.getReader();
    if (!reader) return empty;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const LIMIT = 120_000;
    while (total < LIMIT) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    const html = new TextDecoder("utf-8").decode(buf);

    const image = extractMeta(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ]);
    const title = extractMeta(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);
    const description = extractMeta(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]);

    return { url, image, title, description };
  } catch {
    return empty;
  }
}

// ---- eBay Browse API path -------------------------------------------------
// eBay blocks datacenter HTML requests (403), so OG scraping returns nothing.
// When the URL is an eBay item we use the Browse API instead.

let ebayToken: { value: string; expiresAt: number } | null = null;

async function getEbayToken(): Promise<string | null> {
  const appId = process.env["EBAY_PROD_APP_ID"];
  const certId = process.env["EBAY_PROD_CERT_ID"];
  if (!appId || !certId) return null;
  if (ebayToken && Date.now() < ebayToken.expiresAt) return ebayToken.value;
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${appId}:${certId}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    ebayToken = {
      value: json.access_token,
      expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 7200) - 120) * 1000,
    };
    return ebayToken.value;
  } catch {
    return null;
  }
}

function ebayLegacyId(url: string): string | null {
  const m = url.match(/\/itm\/(?:[^/?#]*\/)?(\d{9,15})/);
  return m ? m[1] : null;
}

async function fetchEbayItem(url: string, legacyId: string): Promise<CompPreview | null> {
  const token = await getEbayToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${legacyId}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      title?: string;
      image?: { imageUrl?: string };
      additionalImages?: { imageUrl?: string }[];
      shortDescription?: string;
      condition?: string;
      price?: { value?: string; currency?: string };
      seller?: { username?: string };
    };
    const image = json.image?.imageUrl ?? json.additionalImages?.[0]?.imageUrl ?? null;
    const bits = [
      json.condition,
      json.price?.value ? `${json.price.currency === "USD" ? "$" : ""}${json.price.value}` : null,
      json.seller?.username ? `Seller ${json.seller.username}` : null,
    ].filter(Boolean);
    return {
      url,
      image,
      title: json.title ?? null,
      description: json.shortDescription ?? (bits.length ? bits.join(" · ") : null),
    };
  } catch {
    return null;
  }
}

export async function fetchCompPreviewsImpl(urls: string[]): Promise<CompPreview[]> {
  const now = Date.now();
  const unique = Array.from(new Set(urls.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))));
  const results = new Map<string, CompPreview>();
  const need: string[] = [];
  for (const u of unique) {
    const cached = previewCache.get(u);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      results.set(u, cached.value);
    } else {
      need.push(u);
    }
  }

  // Concurrency limit — external HTML fetches, keep it modest.
  const CONCURRENCY = 6;
  let i = 0;
  async function worker() {
    while (i < need.length) {
      const idx = i++;
      const u = need[idx];
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const legacyId = /ebay\./i.test(u) ? ebayLegacyId(u) : null;
        let preview: CompPreview | null = legacyId ? await fetchEbayItem(u, legacyId) : null;
        if (!preview || !preview.image) {
          const scraped = await fetchOne(u, ac.signal);
          preview = preview
            ? {
                url: u,
                image: preview.image ?? scraped.image,
                title: preview.title ?? scraped.title,
                description: preview.description ?? scraped.description,
              }
            : scraped;
        }
        previewCache.set(u, { at: Date.now(), value: preview });
        results.set(u, preview);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, need.length) }, worker));

  return unique.map((u) => results.get(u) ?? { url: u, image: null, title: null, description: null });
}
