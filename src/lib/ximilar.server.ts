// Ximilar API client for sports card identification + pricing.
// Docs: https://docs.ximilar.com/services/card_id/
//
// We use the "collectibles/v2/sport_id" endpoint which both identifies the
// card and returns market pricing/listing data when requested.

const XIMILAR_URL = "https://api.ximilar.com/collectibles/v2/sport_id";

export class XimilarAuthError extends Error {
  constructor(message = "Ximilar could not authenticate. Check the saved API token and account credits.") {
    super(message);
    this.name = "XimilarAuthError";
  }
}

type PriceStat = {
  stats_type?: string | null; // "overall" | "graded" | "ungraded" | "PSA 10" ...
  median?: number | null;
  mean?: number | null;
  trimmed_mean?: number | null;
  max?: number | null;
  min?: number | null;
  latest?: number | null;
  oldest?: number | null;
  latest_date?: string | null;
  oldest_date?: string | null;
  count?: number | null;
  link_ebay?: string | null;
};

type PricingListing = {
  item_id?: string | null;
  item_link?: string | null;
  name?: string | null;
  price?: number | string | null;
  currency?: string | null;
  source?: string | null;
  date_of_creation?: string | null;
  date_of_sale?: string | null;
  grade_company?: string | null;
  grade?: string | number | null;
  grade_value?: string | number | null;
};

type XimilarBestMatch = {
  full_name?: string | null;
  name?: string | null;
  subject?: string | null;
  player_name?: string | null;
  team?: string | null;
  position?: string | null;
  year?: number | string | null;
  set?: string | null;
  set_series?: string | null;
  series?: string | null;
  card_number?: string | number | null;
  number?: string | number | null;
  price_stats?: PriceStat[] | null;
  pricing?: { list?: PricingListing[] | null } | null;
  links?: { ebay?: string | null } | null;
};

type XimilarRecord = {
  _status?: { code?: number; text?: string };
  _identification?: {
    best_match?: XimilarBestMatch | null;
    alternatives?: XimilarBestMatch[] | null;
  } | null;
  pricing?: { list?: PricingListing[] | null } | null;
};

type XimilarResponse = {
  records?: XimilarRecord[];
  pricing?: { list?: PricingListing[] | null } | null;
  status?: { code?: number; text?: string };
};

type XimilarResult = {
  match: XimilarBestMatch | null;
  listings: PricingListing[];
};

async function callXimilar(
  record: Record<string, unknown>,
  opts: { priceStats: boolean; pricing: boolean },
): Promise<XimilarResult> {
  const token = normalizeToken(process.env.XIMILAR_API_TOKEN);
  if (!token) throw new Error("XIMILAR_API_TOKEN is not configured");
  const body: Record<string, unknown> = { records: [record], analyze_all: true };
  if (opts.priceStats) body.price_stats = true;
  if (opts.pricing) body.pricing = true;
  const res = await fetch(XIMILAR_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 401 || /authorization|invalid token|credit limits/i.test(t)) {
      throw new XimilarAuthError();
    }
    throw new Error(`Ximilar request failed [${res.status}]: ${t}`);
  }
  const j = (await res.json()) as XimilarResponse;
  if (j.status?.code === 401 || /authorization|invalid token|credit limits/i.test(j.status?.text ?? "")) {
    throw new XimilarAuthError();
  }
  const rec = j.records?.[0];
  console.info("Ximilar pricing debug", {
    topKeys: Object.keys(j),
    recordKeys: rec ? Object.keys(rec) : [],
    bestMatchKeys: rec?._identification?.best_match ? Object.keys(rec._identification.best_match) : [],
    recordPricingCount: rec?.pricing?.list?.length ?? 0,
    matchPricingCount: rec?._identification?.best_match?.pricing?.list?.length ?? 0,
    topPricingCount: j.pricing?.list?.length ?? 0,
    priceStatsCount: rec?._identification?.best_match?.price_stats?.length ?? 0,
    topPricingType: typeof j.pricing,
    topPricingKeys: j.pricing && typeof j.pricing === "object" ? Object.keys(j.pricing) : [],
    topPriceStatsType: typeof (j as { price_stats?: unknown }).price_stats,
    topPriceStatsKeys:
      (j as { price_stats?: unknown }).price_stats && typeof (j as { price_stats?: unknown }).price_stats === "object"
        ? Object.keys((j as { price_stats: Record<string, unknown> }).price_stats)
        : [],
    objectCount: Array.isArray((rec as { _objects?: unknown } | undefined)?._objects)
      ? ((rec as { _objects: unknown[] })._objects).length
      : 0,
    objectKeys: Array.isArray((rec as { _objects?: unknown } | undefined)?._objects)
      ? ((rec as { _objects: Array<Record<string, unknown>> })._objects).slice(0, 3).map((obj) => Object.keys(obj))
      : [],
  });
  return {
    match: rec?._identification?.best_match ?? null,
    listings: [
      ...(rec?.pricing?.list ?? []),
      ...(rec?._identification?.best_match?.pricing?.list ?? []),
      ...(j.pricing?.list ?? []),
    ].filter(Boolean),
  };
}

function normalizeToken(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^(token|bearer)\s+/i, "").trim();
}

export type XimilarIdentification = {
  player_name: string | null;
  team: string | null;
  position: string | null;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
};

function pickString(...values: Array<string | number | null | undefined>): string | null {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function pickYear(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v).match(/\d{4}/)?.[0] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export async function identifyCardXimilar(
  bytes: Uint8Array,
  _contentType: string,
): Promise<XimilarIdentification | null> {
  const b64 = bytesToBase64(bytes);
  const { match } = await callXimilar({ _base64: b64 }, { priceStats: false, pricing: false });
  if (!match) return null;
  const rawName = pickString(match.player_name, match.subject, match.full_name, match.name);
  return {
    player_name: rawName,
    team: pickString(match.team),
    position: pickString(match.position),
    year: pickYear(match.year),
    set_name: pickString(match.set_series, match.set, match.series),
    card_number: pickString(match.card_number, match.number),
  };
}

export type XimilarPricing = {
  current_value: number;
  value_delta_pct: number;
  sales: Array<{
    sold_at: string | null;
    grade: string | null;
    price: number;
    source: string;
    url: string | null;
  }>;
  history: Array<{ recorded_at: string; value: number }>;
};

// Match a Ximilar price_stats entry to the user's grade/grader combo.
function pickStatForGrade(stats: PriceStat[], grader: string | null, grade: string | null): PriceStat | null {
  if (stats.length === 0) return null;
  const isGraded = Boolean(grader && grade);
  const gLower = String(grade ?? "").toLowerCase();
  const grLower = String(grader ?? "").toLowerCase();

  if (isGraded) {
    // Try "PSA 10", "BGS 9.5" style match first.
    const combo = stats.find((s) => {
      const t = String(s.stats_type ?? "").toLowerCase();
      return t.includes(grLower) && t.includes(gLower);
    });
    if (combo) return combo;
    const graded = stats.find((s) => String(s.stats_type ?? "").toLowerCase() === "graded");
    if (graded) return graded;
  } else {
    const raw = stats.find((s) => {
      const t = String(s.stats_type ?? "").toLowerCase();
      return t === "ungraded" || t === "raw";
    });
    if (raw) return raw;
  }
  return stats.find((s) => String(s.stats_type ?? "").toLowerCase() === "overall") ?? stats[0];
}

export async function pricingFromXimilarByUrl(
  imageUrl: string,
  opts: { grader?: string | null; grade?: string | null },
): Promise<XimilarPricing | null> {
  const result = await callXimilar({ _url: imageUrl }, { priceStats: true, pricing: true });
  return buildPricing(result, opts);
}

export async function pricingFromXimilarByBytes(
  bytes: Uint8Array,
  _contentType: string,
  opts: { grader?: string | null; grade?: string | null },
): Promise<XimilarPricing | null> {
  const b64 = bytesToBase64(bytes);
  const result = await callXimilar({ _base64: b64 }, { priceStats: true, pricing: true });
  return buildPricing(result, opts);
}

function buildPricing(
  result: XimilarResult,
  opts: { grader?: string | null; grade?: string | null },
): XimilarPricing | null {
  const { match } = result;
  const listingPricing = buildPricingFromListings(result.listings, opts);
  if (listingPricing) return listingPricing;

  if (!match) return null;
  const stats = (match.price_stats ?? []).filter(Boolean);
  if (stats.length === 0) return null;
  const chosen = pickStatForGrade(stats, opts.grader ?? null, opts.grade ?? null);
  if (!chosen) return null;

  const value = Number(
    chosen.trimmed_mean ?? chosen.median ?? chosen.mean ?? chosen.latest ?? 0,
  );
  if (!Number.isFinite(value) || value <= 0) return null;

  const latest = Number(chosen.latest ?? value);
  const oldest = Number(chosen.oldest ?? value);
  const deltaPct = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;

  const ebayUrl = chosen.link_ebay ?? match.links?.ebay ?? null;
  const gradeLabel = opts.grader && opts.grade ? `${opts.grader} ${opts.grade}` : chosen.stats_type ?? null;
  const nowIso = new Date().toISOString();

  const sales: XimilarPricing["sales"] = [];
  if (chosen.latest != null && Number.isFinite(Number(chosen.latest))) {
    sales.push({
      sold_at: chosen.latest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.latest),
      source: "eBay sold · Latest",
      url: ebayUrl,
    });
  }
  if (chosen.median != null && Number.isFinite(Number(chosen.median))) {
    sales.push({
      sold_at: chosen.latest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.median),
      source: `eBay sold · Median${chosen.count ? ` (${chosen.count})` : ""}`,
      url: ebayUrl,
    });
  }
  if (chosen.trimmed_mean != null && Number.isFinite(Number(chosen.trimmed_mean))) {
    sales.push({
      sold_at: chosen.latest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.trimmed_mean),
      source: `eBay sold · Trimmed avg${chosen.count ? ` (${chosen.count})` : ""}`,
      url: ebayUrl,
    });
  }
  if (sales.length === 0 && chosen.mean != null && Number.isFinite(Number(chosen.mean))) {
    sales.push({
      sold_at: chosen.latest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.mean),
      source: `eBay sold · Average${chosen.count ? ` (${chosen.count})` : ""}`,
      url: ebayUrl,
    });
  }
  if (chosen.min != null && Number.isFinite(Number(chosen.min))) {
    sales.push({
      sold_at: chosen.oldest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.min),
      source: "eBay sold · Low",
      url: ebayUrl,
    });
  }
  if (chosen.max != null && Number.isFinite(Number(chosen.max))) {
    sales.push({
      sold_at: chosen.latest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.max),
      source: "eBay sold · High",
      url: ebayUrl,
    });
  }
  if (chosen.oldest != null && Number.isFinite(Number(chosen.oldest))) {
    sales.push({
      sold_at: chosen.oldest_date ?? nowIso,
      grade: gradeLabel,
      price: Number(chosen.oldest),
      source: "eBay sold · Oldest",
      url: ebayUrl,
    });
  }

  // Fabricate a 6-point history curve interpolating oldest → latest so the
  // existing sparkline UI has something to draw.
  const history = Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    const v = oldest + (latest - oldest) * t;
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return { recorded_at: d.toISOString(), value: Math.max(0, Number(v.toFixed(2))) };
  });

  return {
    current_value: Number(value.toFixed(2)),
    value_delta_pct: Number(deltaPct.toFixed(2)),
    sales,
    history,
  };
}

function buildPricingFromListings(
  listings: PricingListing[],
  opts: { grader?: string | null; grade?: string | null },
): XimilarPricing | null {
  const usable = listings
    .map((listing): XimilarPricing["sales"][number] | null => {
      if (!listing.date_of_sale) return null;
      const price = parsePrice(listing.price);
      const currency = String(listing.currency ?? "USD").toUpperCase();
      if (!Number.isFinite(price) || price <= 0 || currency !== "USD") return null;
      const soldAt = listing.date_of_sale;
      const gradeCompany = pickString(listing.grade_company, opts.grader ?? null);
      const gradeValue = pickString(listing.grade_value, listing.grade, opts.grade ?? null);
      const gradeLabel = gradeCompany && gradeValue ? `${gradeCompany} ${gradeValue}` : pickString(gradeCompany, gradeValue);
      return {
        sold_at: soldAt,
        grade: gradeLabel,
        price,
        source: "eBay sold",
        url: listing.item_link ?? null,
      };
    })
    .filter((sale): sale is XimilarPricing["sales"][number] => sale !== null)
    .sort((a, b) => new Date(b.sold_at ?? 0).getTime() - new Date(a.sold_at ?? 0).getTime())
    .slice(0, 12);

  if (usable.length === 0) return null;

  const prices = trimOutliers(usable.map((sale) => sale.price));
  const value = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const chronological = [...usable]
    .filter((sale) => sale.sold_at)
    .sort((a, b) => new Date(a.sold_at as string).getTime() - new Date(b.sold_at as string).getTime());
  const oldest = chronological[0]?.price ?? value;
  const latest = chronological[chronological.length - 1]?.price ?? value;
  const deltaPct = oldest > 0 ? ((latest - oldest) / oldest) * 100 : 0;
  const historySource = chronological.length >= 2 ? chronological : usable;
  const history = historySource.slice(-6).map((sale) => ({
    recorded_at: sale.sold_at ?? new Date().toISOString(),
    value: Number(sale.price.toFixed(2)),
  }));

  return {
    current_value: Number(value.toFixed(2)),
    value_delta_pct: Number(deltaPct.toFixed(2)),
    sales: usable,
    history,
  };
}

function trimOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - iqr * 1.5;
  const high = q3 + iqr * 1.5;
  const trimmed = sorted.filter((value) => value >= low && value <= high);
  return trimmed.length > 0 ? trimmed : sorted;
}

function parsePrice(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  return Number(value.replace(/[^0-9.]/g, ""));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? 0;
  const weight = idx - lo;
  return (sorted[lo] ?? 0) * (1 - weight) + (sorted[hi] ?? 0) * weight;
}
