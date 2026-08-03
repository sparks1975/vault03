import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trophy, Lock } from "lucide-react";
import { toast as _unused } from "sonner";
import {
  getCurrentShowdown,
  getMyShowdownEntry,
  submitShowdownEntry,
  getMyBadges,
} from "@/lib/showdown.functions";
import {
  LINEUP_SIZE,
  badgeMeta,
  cardBoosts,
  cardMultiplier,
  formatWeekLabel,
} from "@/lib/showdown-scoring";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type ShowdownCard = {
  id: string;
  player_name: string;
  year: number | null;
  set_name: string | null;
  card_number: string | null;
  mlb_player_id: number | null;
  is_autograph: boolean;
  is_rookie: boolean;
  is_first_bowman: boolean;
  serial_number: string | null;
  parallel: string | null;
  grade: string | null;
  photo_thumb_url?: string | null;
  photo_url?: string | null;
};

const fmtPts = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function ShowdownPanel({ cards }: { cards: ShowdownCard[] }) {
  const qc = useQueryClient();
  const showdownFn = useServerFn(getCurrentShowdown);
  const myEntryFn = useServerFn(getMyShowdownEntry);
  const submitFn = useServerFn(submitShowdownEntry);
  const badgesFn = useServerFn(getMyBadges);

  const contestQ = useQuery({ queryKey: ["showdown"], queryFn: () => showdownFn() });
  const contest = contestQ.data?.contest;

  const entryQ = useQuery({
    queryKey: ["showdown-entry", contest?.id],
    queryFn: () => myEntryFn({ data: { contest_id: contest!.id } }),
    enabled: !!contest?.id,
  });

  const badgesQ = useQuery({ queryKey: ["my-badges"], queryFn: () => badgesFn() });

  const [draft, setDraft] = useState<string[] | null>(null);
  const eligible = useMemo(() => cards.filter((c) => !!c.mlb_player_id), [cards]);

  const savedIds = useMemo(
    () => (entryQ.data?.cards ?? []).map((c) => c.card_id),
    [entryQ.data],
  );
  const lineup = draft ?? savedIds;

  const locked = !!contest && (contest.status !== "open" || new Date(contest.lock_at).getTime() <= Date.now());
  const isFinal = contest?.status === "final";

  const submit = useMutation({
    mutationFn: () => submitFn({ data: { contest_id: contest!.id, card_ids: lineup } }),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["showdown"] }),
        qc.invalidateQueries({ queryKey: ["showdown-entry"] }),
        qc.invalidateQueries({ queryKey: ["my-badges"] }),
      ]);
      toast.success("Lineup submitted for this week's Showdown.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not submit your lineup."),
  });

  function toggle(id: string) {
    if (locked) return;
    const next = lineup.includes(id)
      ? lineup.filter((x) => x !== id)
      : lineup.length >= LINEUP_SIZE
        ? lineup
        : [...lineup, id];
    if (!lineup.includes(id) && lineup.length >= LINEUP_SIZE) {
      toast.error(`Lineups are ${LINEUP_SIZE} cards. Remove one first.`);
      return;
    }
    setDraft(next);
  }

  const pointsByCard = useMemo(() => {
    const m = new Map<string, { player_points: number; points: number }>();
    for (const c of entryQ.data?.cards ?? [])
      m.set(c.card_id, { player_points: c.player_points, points: c.points });
    return m;
  }, [entryQ.data]);

  const dirty = draft !== null && JSON.stringify([...draft].sort()) !== JSON.stringify([...savedIds].sort());

  return (
    <section className="border border-border">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="w-4 h-4 text-accent shrink-0" />
          <h3 className="text-sm font-mono uppercase tracking-widest truncate">Weekly Showdown</h3>
        </div>
        {contestQ.isLoading ? (
          <Skeleton className="h-4 w-40" />
        ) : contest ? (
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>Week of {formatWeekLabel(contest.week_start)}</span>
            <span className="text-border">/</span>
            <span className={locked ? "text-muted-foreground" : "text-accent"}>
              {isFinal ? "Final" : locked ? "Locked" : "Open"}
            </span>
            <span className="text-border">/</span>
            <span>{contestQ.data?.entry_count ?? 0} entries</span>
          </div>
        ) : null}
      </header>

      {contestQ.isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border">
          {/* Lineup builder */}
          <div className="bg-background p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Your lineup · {lineup.length}/{LINEUP_SIZE}
              </p>
              {entryQ.data?.entry ? (
                <p className="text-sm font-mono font-bold">
                  {fmtPts(entryQ.data.entry.score)} <span className="text-[10px] text-muted-foreground">PTS</span>
                </p>
              ) : null}
            </div>

            {locked && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Lock className="w-3 h-3" />
                {isFinal ? "This week is final." : "Lineups are locked for this week."}
              </p>
            )}

            {eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible cards yet. Cards need an identified MLB player to play.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border">
                {eligible.map((c) => {
                  const selected = lineup.includes(c.id);
                  const mult = cardMultiplier(c);
                  const scored = pointsByCard.get(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      disabled={locked}
                      className={`w-full text-left flex items-center gap-3 py-2 px-1 transition-colors ${
                        selected ? "bg-accent/10" : "hover:bg-secondary/50"
                      } ${locked ? "cursor-default" : ""}`}
                    >
                      <span
                        className={`w-3 h-3 shrink-0 border ${
                          selected ? "bg-accent border-accent" : "border-border"
                        }`}
                      />
                      {c.photo_thumb_url || c.photo_url ? (
                        <img
                          src={c.photo_thumb_url ?? c.photo_url ?? ""}
                          alt={c.player_name}
                          loading="lazy"
                          className="w-8 h-11 object-cover shrink-0"
                        />
                      ) : (
                        <span className="w-8 h-11 bg-secondary shrink-0" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold truncate">{c.player_name}</span>
                        <span className="block text-[10px] font-mono uppercase tracking-widest text-muted-foreground truncate">
                          {[c.year, c.set_name, c.card_number ? `#${c.card_number}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {cardBoosts(c).length > 0 && (
                          <span className="block text-[10px] text-accent truncate">
                            {cardBoosts(c)
                              .map((b) => b.label)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-mono font-bold">{mult.toFixed(2)}x</span>
                        {scored ? (
                          <span className="block text-[10px] font-mono text-muted-foreground">
                            {fmtPts(scored.points)} pts
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!locked && (
              <Button
                className="mt-4 w-full rounded-sm font-mono uppercase tracking-widest text-xs"
                disabled={lineup.length !== LINEUP_SIZE || submit.isPending || (!dirty && savedIds.length === LINEUP_SIZE)}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" /> Submitting
                  </>
                ) : savedIds.length === LINEUP_SIZE ? (
                  dirty ? "Update lineup" : "Lineup submitted"
                ) : (
                  "Submit lineup"
                )}
              </Button>
            )}
          </div>

          {/* Leaderboard + badges */}
          <div className="bg-background p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
              Global leaderboard
            </p>
            {(contestQ.data?.leaderboard ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No entries yet this week. Be the first on the board.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {(contestQ.data?.leaderboard ?? []).slice(0, 10).map((row) => (
                  <li key={row.user_id} className="flex items-center gap-3 py-2">
                    <span className="w-6 text-xs font-mono text-muted-foreground">{row.rank}</span>
                    <span className="flex-1 min-w-0 text-sm truncate">{row.display_name}</span>
                    <span className="text-sm font-mono font-bold">{fmtPts(row.score)}</span>
                  </li>
                ))}
              </ol>
            )}

            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-6 mb-3">
              Your badges
            </p>
            {badgesQ.isLoading ? (
              <Skeleton className="h-6 w-40" />
            ) : (badgesQ.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Finish top 10% in a weekly Showdown to earn your first badge.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(badgesQ.data ?? []).map((b) => {
                  const meta = badgeMeta(b.badge_type);
                  return (
                    <span
                      key={b.id}
                      className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 border ${meta.tone}`}
                      title={meta.blurb}
                    >
                      {meta.label}
                      {b.week_start ? ` · ${formatWeekLabel(b.week_start)}` : ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
