// Server-only eBay helpers. Never import at module scope from client-reachable files.
// Prefer production credentials when available; fall back to sandbox otherwise.
function ebayEnv() {
  const prodApp = process.env.EBAY_PROD_APP_ID;
  const prodCert = process.env.EBAY_PROD_CERT_ID;
  if (prodApp && prodCert) {
    return { base: "https://api.ebay.com", appId: prodApp, certId: prodCert, mode: "prod" as const };
  }
  const sbxApp = process.env.EBAY_SANDBOX_APP_ID;
  const sbxCert = process.env.EBAY_SANDBOX_CERT_ID;
  if (sbxApp && sbxCert) {
    return { base: "https://api.sandbox.ebay.com", appId: sbxApp, certId: sbxCert, mode: "sandbox" as const };
  }
  throw new Error("eBay credentials not configured");
}

let cachedToken: { token: string; expiresAt: number; mode: string } | null = null;

export async function getAppToken(): Promise<{ token: string; base: string }> {
  const env = ebayEnv();
  if (cachedToken && cachedToken.mode === env.mode && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.token, base: env.base };
  }
  const basic = Buffer.from(`${env.appId}:${env.certId}`).toString("base64");
  const res = await fetch(`${env.base}/identity/v1/oauth2/token`, {
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
  cachedToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000, mode: env.mode };
  return { token: j.access_token, base: env.base };
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
  const { token, base } = await getAppToken();
  const res = await fetch(`${base}/buy/browse/v1/item_summary/search?${params.toString()}`, {
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
  const { token, base } = await getAppToken();
  const res = await fetch(`${base}/buy/browse/v1/item_summary/search_by_image?limit=5&category_ids=213`, {
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
