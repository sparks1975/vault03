import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UsageEvent = {
  created_at: string;
  endpoint: string;
  query: string | null;
  ok: boolean;
  status: number | null;
  result_count: number | null;
  duration_ms: number | null;
  remaining: number | null;
  daily_limit: number | null;
};

export type UsageSummary = {
  visible: boolean;
  today: number;
  today_failed: number;
  today_empty: number;
  last7: number;
  last30: number;
  avg_duration_ms: number | null;
  daily_limit: number | null;
  remaining: number | null;
  daily: { date: string; count: number; failed: number }[];
  recent: UsageEvent[];
};

const EMPTY: UsageSummary = {
  visible: false,
  today: 0,
  today_failed: 0,
  today_empty: 0,
  last7: 0,
  last30: 0,
  avg_duration_ms: null,
  daily_limit: null,
  remaining: null,
  daily: [],
  recent: [],
};

// Usage telemetry. RLS limits these rows to admins, so non-admins simply get
// an empty summary (visible: false). Day buckets use the viewer's local time
// zone (passed from the browser), not UTC, so evening usage counts as "today".
function dayKeyInTz(iso: string, timeZone: string): string {
  try {
    // en-CA yields YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

async function summarize(
  supabase: { from: (t: "api_usage_events") => any },
  providers: string[],
  timeZone: string,
): Promise<UsageSummary> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("api_usage_events")
    .select("created_at, endpoint, query, ok, status, result_count, duration_ms, remaining, daily_limit")
    .in("provider", providers)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw error;
  const rows = (data ?? []) as UsageEvent[];
  if (rows.length === 0) return { ...EMPTY, visible: true };

  const dayKey = (iso: string) => dayKeyInTz(iso, timeZone);
  const todayKey = dayKey(new Date().toISOString());
  const sevenAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const counts = new Map<string, { count: number; failed: number }>();
  for (let i = 13; i >= 0; i--) {
    counts.set(dayKey(new Date(Date.now() - i * 86400000).toISOString()), { count: 0, failed: 0 });
  }

  let today = 0;
  let todayFailed = 0;
  let todayEmpty = 0;
  let last7 = 0;
  let durSum = 0;
  let durN = 0;

  for (const r of rows) {
    const k = dayKey(r.created_at);
    const bucket = counts.get(k);
    if (bucket) {
      bucket.count += 1;
      if (!r.ok) bucket.failed += 1;
    }
    if (k === todayKey) {
      today += 1;
      if (!r.ok) todayFailed += 1;
      else if (r.result_count != null && r.result_count === 0) todayEmpty += 1;
    }
    if (new Date(r.created_at).getTime() >= sevenAgo) last7 += 1;
    if (r.duration_ms != null) {
      durSum += r.duration_ms;
      durN += 1;
    }
  }

  const latestWithLimit = rows.find((r) => r.daily_limit != null || r.remaining != null);

  return {
    visible: true,
    today,
    today_failed: todayFailed,
    today_empty: todayEmpty,
    last7,
    last30: rows.length,
    avg_duration_ms: durN ? Math.round(durSum / durN) : null,
    daily_limit: latestWithLimit?.daily_limit ?? null,
    remaining: latestWithLimit?.remaining ?? null,
    daily: [...counts.entries()].map(([date, v]) => ({ date, ...v })),
    recent: rows.slice(0, 10),
  };
}

export const getPricingApiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }): Promise<UsageSummary> => summarize(context.supabase as never, ["thecardapi"]));

// Card identification: Cardsight catalog lookups + the AI vision reads.
export const getIdentificationApiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }): Promise<UsageSummary> => summarize(context.supabase as never, ["cardsight", "lovable-ai"]));
