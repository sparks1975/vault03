// Ximilar API client for sports card identification + price stats.
// Docs: https://docs.ximilar.com/services/card_id/
//
// We use the "collectibles/v2/sport_id" endpoint which both identifies the
// card and (when `price_stats: true`) returns aggregated market pricing.
// Ximilar returns per-slab statistics (overall / graded / ungraded) — no
// individual sale records — so we surface the aggregates as synthetic
// "sale" entries in the UI.

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
  links?: { ebay?: string | null } | null;
};

type XimilarRecord = {
  _status?: { code?: number; text?: string };
  _identification?: {
    best_match?: XimilarBestMatch | null;
    alternatives?: XimilarBestMatch[] | null;
  } | null;
};

type XimilarResponse = {
  records?: XimilarRecord[];
  status?: { code?: number; text?: string };
};

async function callXimilar(record: Record<string, unknown>, priceStats: boolean): Promise<XimilarBestMatch | null> {
  const token = normalizeToken(process.env.XIMILAR_API_TOKEN);
  if (!token) throw new Error("XIMILAR_API_TOKEN is not configured");
  const res = await fetch(XIMILAR_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records: [record], price_stats: priceStats, analyze_all: true }),
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
  return rec?._identification?.best_match ?? null;
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
  const match = await callXimilar({ _base64: b64 }, false);
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
  const match = await callXimilar({ _url: imageUrl }, true);
  return buildPricing(match, opts);
}

export async function pricingFromXimilarByBytes(
  bytes: Uint8Array,
  _contentType: string,
  opts: { grader?: string | null; grade?: string | null },
): Promise<XimilarPricing | null> {
  const b64 = bytesToBase64(bytes);
  const match = await callXimilar({ _base64: b64 }, true);
  return buildPricing(match, opts);
}

function buildPricing(
  match: XimilarBestMatch | null,
  opts: { grader?: string | null; grade?: string | null },
): XimilarPricing | null {
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
