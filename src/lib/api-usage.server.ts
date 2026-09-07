// Shared outbound-API usage telemetry. SERVER-ONLY module.
// One row per outbound provider request so the dashboard can report volume,
// failures, latency and (when the provider reports it) remaining allowance.
export type ApiUsageRow = {
  endpoint: string;
  query?: string | null;
  ok: boolean;
  status?: number | null;
  result_count?: number | null;
  raw_count?: number | null;
  duration_ms?: number | null;
  daily_limit?: number | null;
  remaining?: number | null;
};

export async function logApiUsage(provider: string, row: ApiUsageRow): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("api_usage_events").insert({ provider, ...row });
  } catch (err) {
    console.error(`[${provider}] usage log failed:`, err);
  }
}
