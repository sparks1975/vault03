import { baseSetName } from "@/lib/card-sets";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";

import { listCards } from "@/lib/cards.functions";
import { getCurrentShowdown, getMyShowdownEntry } from "@/lib/showdown.functions";
import { AppNav, MobileNavTabs } from "@/components/AppNav";
import { ShareDialog } from "@/components/ShareDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CollectorIllustration } from "@/components/CollectorIllustration";
import topMoverAsset from "@/assets/dashboard.svg.asset.json";
import showdownAsset from "@/assets/showdown.svg.asset.json";


export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Vault.03" },
      { name: "description", content: "Portfolio analytics for your Vault.03 baseball card collection: total value, gains, and your top holdings." },
      { property: "og:title", content: "Dashboard — Vault.03" },
      { property: "og:description", content: "Portfolio analytics for your Vault.03 baseball card collection: total value, gains, and your top holdings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

type DashCard = {
  id: string;
  player_name: string;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  grade: string | null;
  grader: string | null;
  purchase_price: number | null;
  current_value: number | null;
  is_autograph: boolean | null;
  is_rookie: boolean | null;
  is_first_bowman: boolean | null;
  photo_url: string | null;
  photo_thumb_url?: string | null;
  created_at: string;
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(n));
}
function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function gainDollars(c: { purchase_price: number | null; current_value: number | null }) {
  if (c.current_value == null) return null;
  return Number(c.current_value) - Number(c.purchase_price ?? 0);
}
function gainPct(c: { purchase_price: number | null; current_value: number | null }) {
  if (c.current_value == null) return null;
  const p = Number(c.purchase_price ?? 0);
  if (p <= 0) return null;
  return ((Number(c.current_value) - p) / p) * 100;
}

function DashboardPage() {
  const listFn = useServerFn(listCards);
  const cardsQ = useQuery({ queryKey: ["cards"], queryFn: () => listFn() });
  const cards = (cardsQ.data ?? []) as unknown as DashCard[];

  const s = useMemo(() => {
    const totalValue = cards.reduce((sum, c) => sum + Number(c.current_value ?? 0), 0);
    const totalCost = cards.reduce((sum, c) => sum + Number(c.purchase_price ?? 0), 0);
    const graded = cards.filter((c) => c.grade).length;
    const valued = cards.filter((c) => c.current_value != null).length;
    const autos = cards.filter((c) => c.is_autograph).length;
    const rookies = cards.filter((c) => c.is_rookie).length;
    const withGain = cards
      .map((c) => ({ card: c, dollars: gainDollars(c), pct: gainPct(c) }))
      .filter((x): x is { card: DashCard; dollars: number; pct: number | null } => x.dollars != null)
      .sort((a, b) => b.dollars - a.dollars);
    const top5 = [...cards]
      .sort((a, b) => Number(b.current_value ?? 0) - Number(a.current_value ?? 0))
      .slice(0, 5);
    const setCounts = new Map<string, number>();
    for (const c of cards) {
      const key = baseSetName(c.set_name) ?? "Unknown set";
      setCounts.set(key, (setCounts.get(key) ?? 0) + 1);
    }
    const topSets = [...setCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      totalValue,
      totalCost,
      count: cards.length,
      gradedPct: cards.length ? Math.round((graded / cards.length) * 100) : 0,
      valued,
      autos,
      rookies,
      avgValue: cards.length ? totalValue / cards.length : 0,
      totalGain: totalCost > 0 ? totalValue - totalCost : null,
      totalGainPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null,
      topMover: withGain[0] ?? null,
      top5,
      topSets,
    };
  }, [cards]);

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 overflow-x-clip">
      <AppNav actions={<ShareDialog />} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-0 md:pt-12">
        <div className="sticky top-16 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-4 bg-black lg:hidden">
          <MobileNavTabs />
        </div>


        {cardsQ.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-background p-5 md:p-6 lg:p-8 space-y-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <header className="border border-border animate-in-up">
              <div className="border-b border-border flex items-center justify-center px-2 py-3 sm:py-4 md:py-6 md:px-0 overflow-hidden">
                <CollectorIllustration className="w-full h-auto max-h-48 sm:max-h-56 md:max-h-none object-contain" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border">
                <StatCell label="Total Value" value={fmt(s.totalValue)} sub={s.count ? "Live" : "Add your first card"} subAccent={s.count > 0} />
                <StatCell label="Assets" value={String(s.count)} sub={s.count ? `Graded: ${s.gradedPct}%` : "—"} />
                <StatCell label="Cost Basis" value={fmt(s.totalCost)} sub={`${s.valued} valued`} />
                <StatCell
                  label="Total Gain"
                  value={s.totalGain == null ? "—" : `${s.totalGain >= 0 ? "+" : ""}${fmt(s.totalGain)}`}
                  sub={s.totalGainPct != null ? `${fmtPct(s.totalGainPct)} vs. cost` : "Add purchase prices"}
                />
                <SmallStat label="Avg Card Value" value={fmt(s.avgValue)} />
                <SmallStat label="Autographs" value={String(s.autos)} />
                <SmallStat label="Rookies" value={String(s.rookies)} />
                <SmallStat label="1st Bowman" value={String(cards.filter((c) => c.is_first_bowman).length)} />
              </div>
            </header>


            <div className="mt-8 md:mt-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <section className="lg:col-span-7 animate-in-up flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-mono uppercase tracking-widest">Top 5 by value</h2>
                  <Link to="/vault" className="text-[10px] font-mono uppercase tracking-widest text-accent hover:underline">
                    View my vault
                  </Link>
                </div>
                {s.top5.length === 0 ? (
                  <div className="p-12 border border-border text-center">
                    <p className="text-sm text-muted-foreground mb-4">Your vault is empty.</p>
                    <Link
                      to="/vault"
                      className="px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors"
                    >
                      Add your first card
                    </Link>
                  </div>
                ) : (
                  <ol className="divide-y divide-border border border-border">
                    {s.top5.map((c, i) => (
                      <li key={c.id} className="flex items-center gap-3 p-3">
                        <span className="w-5 text-xs font-mono text-muted-foreground">{i + 1}</span>
                        {c.photo_thumb_url || c.photo_url ? (
                          <img
                            src={c.photo_thumb_url ?? c.photo_url ?? ""}
                            alt={c.player_name}
                            loading="lazy"
                            className="w-10 h-14 object-cover shrink-0"
                          />
                        ) : (
                          <span className="w-10 h-14 bg-secondary shrink-0" />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold truncate">{c.player_name}</span>
                          <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground truncate">
                            {[c.year, c.set_name, c.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-mono font-bold">{fmt(c.current_value)}</span>
                          {gainPct(c) != null && (
                            <span
                              className={`block text-[10px] font-mono ${(gainPct(c) ?? 0) >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}
                            >
                              {fmtPct(gainPct(c))}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-6 border border-border p-6 md:p-8 animate-in-up [animation-delay:150ms] flex-1 flex flex-col md:flex-row items-center gap-6">
                  <img
                    src={showdownAsset.url}
                    alt="Weekly Showdown illustration"
                    className="h-44 sm:h-52 md:h-40 w-auto shrink-0 object-contain"
                  />
                  <div className="flex flex-col">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-accent mb-3">From the vault</p>
                    <h3 className="text-lg md:text-xl font-bold leading-tight mb-2">
                      Track. Compare. Compete.
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4 max-w-md">
                      Your vault is more than a list — it's a living portfolio. Build a five-card lineup each week and climb the Weekly Showdown leaderboard.
                    </p>
                    <Link
                      to="/showdown"
                      className="self-start inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-accent transition-colors"
                    >
                      Play Weekly Showdown
                    </Link>
                  </div>
                </div>
              </section>

              <aside className="lg:col-span-5 space-y-8 animate-in-up [animation-delay:100ms]">
                <div className="border border-border p-6">
                  <div className="flex flex-col md:flex-row items-center gap-4">
                    <div className="flex-1 min-w-0 w-full order-first md:order-last">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Top Mover</p>
                      {s.topMover ? (
                        <div className="space-y-1">
                          <h3 className="font-bold leading-tight break-words">
                            {[s.topMover.card.year, s.topMover.card.set_name, s.topMover.card.player_name].filter(Boolean).join(" ")}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {[s.topMover.card.grader, s.topMover.card.grade].filter(Boolean).join(" ") || "Raw"}
                          </p>
                          <p
                            className={`font-mono font-bold ${s.topMover.dollars >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}
                          >
                            {s.topMover.dollars >= 0 ? "+" : ""}
                            {fmt(s.topMover.dollars)}
                            {s.topMover.pct != null && ` (${fmtPct(s.topMover.pct)})`}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Add purchase prices to track gains.</p>
                      )}
                    </div>
                    <img
                      src={topMoverAsset.url}
                      alt="Top mover illustration"
                      className="w-full h-auto md:h-24 md:w-auto shrink-0 object-contain order-last md:order-first"
                    />
                  </div>
                </div>

                <div className="border border-border p-6">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Sets by count</p>
                  {s.topSets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No cards yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {s.topSets.map(([name, count]) => (
                        <li key={name} className="flex items-center gap-3">
                          <span className="flex-1 min-w-0 text-sm truncate">{name}</span>
                          <span className="h-1 w-24 bg-secondary shrink-0">
                            <span
                              className="block h-1 bg-accent"
                              style={{ width: `${Math.round((count / s.topSets[0][1]) * 100)}%` }}
                            />
                          </span>
                          <span className="w-6 text-right text-xs font-mono text-muted-foreground">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <ShowdownSummary />

              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StatCell({ label, value, sub, subAccent }: { label: string; value: string; sub?: string; subAccent?: boolean }) {
  return (
    <div className="@container min-w-0 bg-background p-5 md:p-6 lg:p-8">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      <h2 className="font-extrabold tracking-tight leading-tight text-[clamp(1.15rem,11cqw,2.25rem)] whitespace-nowrap overflow-hidden">
        {value}
      </h2>
      {sub && <p className={`text-xs font-mono mt-2 ${subAccent ? "text-accent" : "text-muted-foreground"}`}>{sub}</p>}
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="@container min-w-0 bg-background p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className="font-bold tracking-tight leading-tight text-[clamp(0.95rem,9cqw,1.125rem)] whitespace-nowrap overflow-hidden">
        {value}
      </p>
    </div>
  );
}

// Dashboard Showdown tile: shows this week's actual results (your score, rank
// and the leaderboard leaders) instead of a static marketing message.
function ShowdownSummary() {
  const showdownFn = useServerFn(getCurrentShowdown);
  const myEntryFn = useServerFn(getMyShowdownEntry);

  const contestQ = useQuery({ queryKey: ["showdown"], queryFn: () => showdownFn() });
  const contest = contestQ.data?.contest;
  const leaderboard = contestQ.data?.leaderboard ?? [];

  const entryQ = useQuery({
    queryKey: ["showdown-entry", contest?.id],
    queryFn: () => myEntryFn({ data: { contest_id: contest!.id } }),
    enabled: !!contest?.id,
  });

  const myScore = entryQ.data?.entry?.score ?? null;
  const myRank =
    myScore == null ? null : leaderboard.filter((r) => r.score > myScore).length + 1;
  const pts = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <Link to="/showdown" className="block border border-border p-6 hover:bg-secondary/40 transition-colors">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Weekly Showdown</p>
        {contest ? (
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {contest.status === "final" ? "Final" : "Live"}
          </span>
        ) : null}
      </div>

      {contestQ.isLoading || entryQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <>
          <div className="flex items-end gap-6 mb-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Your points</p>
              <p className="text-3xl font-black leading-tight tracking-tight">
                {myScore == null ? "—" : pts(myScore)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Rank</p>
              <p className="text-3xl font-black leading-tight tracking-tight">
                {myRank == null ? "—" : `#${myRank}`}
                {myRank != null && leaderboard.length > 0 ? (
                  <span className="text-sm font-mono font-normal text-muted-foreground"> / {leaderboard.length}</span>
                ) : null}
              </p>
            </div>
          </div>

          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entries scored yet this week — set your lineup to get on the board.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {leaderboard.slice(0, 3).map((row) => (
                <li key={row.user_id} className="flex items-center gap-3 py-2">
                  <span className="w-4 text-xs font-mono text-muted-foreground">{row.rank}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{row.display_name}</span>
                  <span className="text-sm font-mono font-bold">{pts(row.score)}</span>
                </li>
              ))}
            </ol>
          )}

          {myScore == null ? (
            <p className="text-xs text-muted-foreground mt-3">You have no lineup in this week yet.</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-3">
              {(entryQ.data?.cards ?? []).length} cards in your lineup
            </p>
          )}
        </>
      )}
    </Link>
  );
}
