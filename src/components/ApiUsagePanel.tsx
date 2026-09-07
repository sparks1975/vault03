import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getIdentificationApiUsage, getPricingApiUsage, type UsageSummary } from "@/lib/usage.functions";
import { Skeleton } from "@/components/ui/skeleton";

function fmtDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

type PanelProps = {
  title: string;
  queryKey: string;
  fetcher: () => Promise<UsageSummary>;
  resultLabel: string;
  showAllowance?: boolean;
  showEmpty?: boolean;
};

function ApiUsagePanel({ title, queryKey, fetcher, resultLabel, showAllowance = true, showEmpty = true }: PanelProps) {
  const q = useQuery({ queryKey: [queryKey], queryFn: fetcher });

  if (q.isLoading) {
    return (
      <div className="border border-border p-6 space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const u = q.data;
  if (!u || !u.visible) return null;

  const max = Math.max(1, ...u.daily.map((d) => d.count));
  const usedToday =
    showAllowance && u.daily_limit != null && u.remaining != null ? u.daily_limit - u.remaining : null;

  return (
    <div className="border border-border p-6">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{title}</p>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Last 30 days</span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Today</p>
          <p className="text-2xl font-black leading-tight tracking-tight">
            {(usedToday ?? u.today).toLocaleString()}
          </p>
          {usedToday != null && usedToday !== u.today && (
            <p className="text-[10px] font-mono text-muted-foreground mt-1">{u.today} logged here</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">7 days</p>
          <p className="text-2xl font-black leading-tight tracking-tight">{u.last7.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">30 days</p>
          <p className="text-2xl font-black leading-tight tracking-tight">{u.last30.toLocaleString()}</p>
        </div>
      </div>

      {showAllowance && u.daily_limit != null && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Daily allowance</p>
            <p className="text-xs font-mono">
              {usedToday != null ? usedToday.toLocaleString() : "—"} / {u.daily_limit.toLocaleString()}
            </p>
          </div>
          <span className="block h-1 w-full bg-secondary">
            <span
              className="block h-1 bg-accent"
              style={{ width: `${Math.min(100, Math.round(((usedToday ?? 0) / u.daily_limit) * 100))}%` }}
            />
          </span>
          {u.remaining != null && (
            <p className="text-[10px] font-mono text-muted-foreground mt-2">
              {u.remaining.toLocaleString()} requests remaining
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Requests / day</p>
      <div className="flex items-end gap-1 h-20 mb-4">
        {u.daily.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${d.date}: ${d.count}`}>
            {d.failed > 0 && (
              <span
                className="block w-full bg-[color:var(--negative)]"
                style={{ height: `${Math.round((d.failed / max) * 100)}%` }}
              />
            )}
            <span
              className="block w-full bg-accent"
              style={{ height: `${Math.round(((d.count - d.failed) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mb-5">
        <span>{u.daily.length ? fmtDay(u.daily[0].date) : ""}</span>
        <span>{u.daily.length ? fmtDay(u.daily[u.daily.length - 1].date) : ""}</span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5 border-t border-border pt-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Failed today</p>
          <p className="text-sm font-mono font-bold">{u.today_failed}</p>
        </div>
        {showEmpty && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">No results</p>
            <p className="text-sm font-mono font-bold">{u.today_empty}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Avg time</p>
          <p className="text-sm font-mono font-bold">
            {u.avg_duration_ms == null ? "—" : `${(u.avg_duration_ms / 1000).toFixed(1)}s`}
          </p>
        </div>
      </div>

      {u.recent.length > 0 && (
        <>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Recent lookups</p>
          <ul className="divide-y divide-border">
            {u.recent.map((r, i) => (
              <li key={`${r.created_at}-${i}`} className="flex items-center gap-3 py-2">
                <span className="w-12 shrink-0 text-[10px] font-mono text-muted-foreground">
                  {new Date(r.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="flex-1 min-w-0 text-xs truncate">{r.query ?? r.endpoint}</span>
                <span
                  className={`shrink-0 text-[10px] font-mono ${!r.ok ? "text-[color:var(--negative)]" : "text-muted-foreground"}`}
                >
                  {!r.ok ? "error" : r.result_count == null ? "ok" : `${r.result_count} ${resultLabel}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function PricingApiUsage() {
  const fetcher = useServerFn(getPricingApiUsage);
  return (
    <ApiUsagePanel
      title="Valuation API usage"
      queryKey="pricing-api-usage"
      fetcher={() => fetcher()}
      resultLabel="sales"
    />
  );
}

export function IdentificationApiUsage() {
  const fetcher = useServerFn(getIdentificationApiUsage);
  return (
    <ApiUsagePanel
      title="Identification API usage"
      queryKey="identification-api-usage"
      fetcher={() => fetcher()}
      resultLabel="results"
      showAllowance={false}
      showEmpty={false}
    />
  );
}
