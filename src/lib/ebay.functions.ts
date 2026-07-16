import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Sandbox base. Swap to api.ebay.com when production keys are added.
const EBAY_BASE = "https://api.sandbox.ebay.com";
const OAUTH_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;
const BROWSE_URL = `${EBAY_BASE}/buy/browse/v1/item_summary/search`;
const BROWSE_IMAGE_URL = `${EBAY_BASE}/buy/browse/v1/item_summary/search_by_image`;

// In-memory token cache (per server instance).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  const appId = process.env.EBAY_SANDBOX_APP_ID;
  const certId = process.env.EBAY_SANDBOX_CERT_ID;
  if (!appId || !certId) throw new Error("eBay sandbox credentials not configured");

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) {
    throw new Error(`eBay OAuth failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

type ItemSummary = {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl?: string;
  image?: { imageUrl: string };
  condition?: string;
  itemEndDate?: string;
};

async function browseSearch(params: URLSearchParams): Promise<ItemSummary[]> {
  const token = await getAppToken();
  const res = await fetch(`${BROWSE_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  if (!res.ok) throw new Error(`eBay Browse failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { itemSummaries?: ItemSummary[] };
  return j.itemSummaries ?? [];
}

function buildQuery(input: {
  player_name: string;
  year?: number | null;
  set_name?: string | null;
  card_number?: string | null;
  grader?: string | null;
  grade?: string | null;
}): string {
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

const CardInput = z.object({
  player_name: z.string().min(1),
  year: z.number().int().optional().nullable(),
  set_name: z.string().optional().nullable(),
  card_number: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  grader: z.string().optional().nullable(),
});

// ---------- Active listings (works in sandbox with mock catalog) ----------
export const searchActiveListings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CardInput.parse(d))
  .handler(async ({ data }) => {
    const q = buildQuery(data);
    const params = new URLSearchParams({
      q,
      limit: "10",
      category_ids: "213", // Sports Trading Cards
    });
    try {
      const items = await browseSearch(params);
      return {
        query: q,
        listings: items.map((it) => ({
          item_id: it.itemId,
          title: it.title,
          price: it.price ? Number(it.price.value) : null,
          currency: it.price?.currency ?? "USD",
          condition: it.condition ?? null,
          image_url: it.image?.imageUrl ?? null,
          url: it.itemWebUrl ?? null,
        })),
      };
    } catch (err) {
      return { query: q, listings: [], error: err instanceof Error ? err.message : "eBay error" };
    }
  });

// ---------- Sold comps ----------
// Note: true sold data requires the Marketplace Insights API (limited-release
// approval from eBay). Until approved, we return active listings as a proxy
// with sold_at=null. Once approved, switch to /buy/marketplace_insights/v1_beta/item_sales/search.
export const searchSoldComps = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CardInput.parse(d))
  .handler(async ({ data }) => {
    const q = buildQuery(data);
    const params = new URLSearchParams({
      q,
      limit: "10",
      category_ids: "213",
      sort: "price",
    });
    try {
      const items = await browseSearch(params);
      const sales = items
        .filter((it) => it.price)
        .map((it) => ({
          sold_at: null as string | null,
          grade: null as string | null,
          price: Number(it.price!.value),
          source: "eBay" as const,
          url: it.itemWebUrl ?? null,
          title: it.title,
        }));
      const prices = sales.map((s) => s.price).sort((a, b) => a - b);
      const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
      return { query: q, sales, median_price: median };
    } catch (err) {
      return {
        query: q,
        sales: [],
        median_price: 0,
        error: err instanceof Error ? err.message : "eBay error",
      };
    }
  });

// ---------- Identify a card from a photo ----------
export const identifyByImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ imageDataUrl: z.string().startsWith("data:image/") }).parse(d),
  )
  .handler(async ({ data }) => {
    // eBay wants raw base64 (no data: prefix).
    const base64 = data.imageDataUrl.split(",")[1] ?? "";
    const token = await getAppToken();
    try {
      const res = await fetch(`${BROWSE_IMAGE_URL}?limit=5&category_ids=213`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        body: JSON.stringify({ image: base64 }),
      });
      if (!res.ok) {
        return { matches: [], error: `eBay image search failed: ${res.status}` };
      }
      const j = (await res.json()) as { itemSummaries?: ItemSummary[] };
      return {
        matches: (j.itemSummaries ?? []).map((it) => ({
          item_id: it.itemId,
          title: it.title,
          price: it.price ? Number(it.price.value) : null,
          image_url: it.image?.imageUrl ?? null,
          url: it.itemWebUrl ?? null,
        })),
      };
    } catch (err) {
      return { matches: [], error: err instanceof Error ? err.message : "eBay error" };
    }
  });
