// Server-only eBay helpers. Never import at module scope from client-reachable files.
const EBAY_BASE = "https://api.sandbox.ebay.com";
const OAUTH_URL = `${EBAY_BASE}/identity/v1/oauth2/token`;
const BROWSE_URL = `${EBAY_BASE}/buy/browse/v1/item_summary/search`;
const BROWSE_IMAGE_URL = `${EBAY_BASE}/buy/browse/v1/item_summary/search_by_image`;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAppToken(): Promise<string> {
  const appId = process.env.EBAY_SANDBOX_APP_ID;
  const certId = process.env.EBAY_SANDBOX_CERT_ID;
  if (!appId || !certId) throw new Error("eBay sandbox credentials not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const basic = Buffer.from(`${appId}:${certId}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`eBay OAuth failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type ItemSummary = {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl?: string;
  image?: { imageUrl: string };
  condition?: string;
};

export type CardDescriptor = {
  player_name: string;
  year?: number | null;
  set_name?: string | null;
  card_number?: string | null;
  grade?: string | null;
  grader?: string | null;
};

export function buildQuery(input: CardDescriptor): string {
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

export async function browseSearch(params: URLSearchParams): Promise<ItemSummary[]> {
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

export async function browseByImage(base64: string): Promise<ItemSummary[]> {
  const token = await getAppToken();
  const res = await fetch(`${BROWSE_IMAGE_URL}?limit=5&category_ids=213`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) throw new Error(`eBay image search failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { itemSummaries?: ItemSummary[] };
  return j.itemSummaries ?? [];
}

export async function searchCardListings(
  input: CardDescriptor,
  opts: { limit?: number; sort?: string } = {},
) {
  const q = buildQuery(input);
  const params = new URLSearchParams({
    q,
    limit: String(opts.limit ?? 10),
    category_ids: "213",
  });
  if (opts.sort) params.set("sort", opts.sort);
  const items = await browseSearch(params);
  return { query: q, items };
}
