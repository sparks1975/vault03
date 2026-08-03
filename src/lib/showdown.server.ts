// Server-only engine for the Weekly Showdown: contest lifecycle, MLB stat
// fetching, scoring, and badge awards. Only reachable from server handlers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  hittingPoints,
  pitchingPoints,
  lockAt,
  round2,
  toDateString,
  weekEnd,
  weekStart,
  type RawStats,
} from "@/lib/showdown-scoring";

type Admin = SupabaseClient<Database>;

const SPORT_IDS = "1,11,12,13,14,16";

export type ContestRow = Database["public"]["Tables"]["contests"]["Row"];

/** Creates the contest for the week containing `ref` if missing; returns it. */
export async function ensureContestForWeek(admin: Admin, ref: Date = new Date()): Promise<ContestRow> {
  const start = weekStart(ref);
  const startIso = toDateString(start);


  const { data: existing, error } = await admin
    .from("contests")
    .select("*")
    .eq("week_start", startIso)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insErr } = await admin
    .from("contests")
    .insert({
      week_start: startIso,
      week_end: toDateString(weekEnd(start)),
      lock_at: lockAt(start).toISOString(),
      status: "open",
    })
    .select("*")
    .single();
  if (insErr) {
    // Another concurrent run may have created it.
    const { data: retry } = await admin
      .from("contests")
      .select("*")
      .eq("week_start", startIso)
      .maybeSingle();
    if (retry) return retry;
    throw insErr;
  }
  return created;
}

async function mlbJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MLB API ${res.status}`);
  return res.json();
}

type StatSplit = { stat?: RawStats };
type StatGroupBlock = { group?: { displayName?: string }; splits?: StatSplit[] };

/**
 * Total fantasy points a player earned between two dates, combining hitting and
 * pitching. One HTTP call per player.
 */
export async function fetchPlayerWeekPoints(
  playerId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const url =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
    `?stats=byDateRange&group=hitting,pitching` +
    `&startDate=${startDate}&endDate=${endDate}&sportIds=${SPORT_IDS}`;
  let body: unknown;
  try {
    body = await mlbJson(url);
  } catch {
    return 0;
  }
  const groups = ((body as { stats?: StatGroupBlock[] })?.stats ?? []) as StatGroupBlock[];
  let total = 0;
  for (const g of groups) {
    const group = (g.group?.displayName ?? "").toLowerCase();
    for (const split of g.splits ?? []) {
      const stat = split.stat;
      if (!stat) continue;
      if (group === "hitting") total += hittingPoints(stat);
      else if (group === "pitching") total += pitchingPoints(stat);
    }
  }
  return round2(total);
}

/**
 * Recomputes every entry's score for a contest. One MLB call per distinct
 * rostered player, cached for the duration of the run.
 */
export async function scoreContest(admin: Admin, contest: ContestRow) {
  const { data: rows, error } = await admin
    .from("contest_entry_cards")
    .select("id, entry_id, mlb_player_id, multiplier")
    .in(
      "entry_id",
      (
        (
          await admin.from("contest_entries").select("id").eq("contest_id", contest.id)
        ).data ?? []
      ).map((e) => e.id),
    );
  if (error) throw error;
  const entryCards = rows ?? [];
  if (entryCards.length === 0) return { entries: 0, players: 0 };

  const playerIds = Array.from(
    new Set(entryCards.map((r) => r.mlb_player_id).filter((v): v is number => typeof v === "number")),
  );

  const points = new Map<number, number>();
  for (const id of playerIds) {
    points.set(id, await fetchPlayerWeekPoints(id, contest.week_start, contest.week_end));
  }

  const perEntry = new Map<string, { score: number; multiplier: number }>();
  for (const row of entryCards) {
    const pp = row.mlb_player_id ? (points.get(row.mlb_player_id) ?? 0) : 0;
    const mult = Number(row.multiplier) || 1;
    const total = round2(pp * mult);
    await admin
      .from("contest_entry_cards")
      .update({ player_points: pp, points: total })
      .eq("id", row.id);
    const agg = perEntry.get(row.entry_id) ?? { score: 0, multiplier: 0 };
    agg.score += total;
    agg.multiplier += mult;
    perEntry.set(row.entry_id, agg);
  }

  for (const [entryId, agg] of perEntry) {
    await admin
      .from("contest_entries")
      .update({ score: round2(agg.score), multiplier_total: round2(agg.multiplier) })
      .eq("id", entryId);
  }

  return { entries: perEntry.size, players: playerIds.length };
}

/** Marks a contest final and awards placement badges. */
export async function finalizeContest(admin: Admin, contest: ContestRow) {
  const { data: entries, error } = await admin
    .from("contest_entries")
    .select("id, user_id, score, multiplier_total, submitted_at")
    .eq("contest_id", contest.id);
  if (error) throw error;

  const ranked = [...(entries ?? [])].sort((a, b) => {
    const d = Number(b.score) - Number(a.score);
    if (d !== 0) return d;
    const m = Number(b.multiplier_total) - Number(a.multiplier_total);
    if (m !== 0) return m;
    return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
  });

  const awards: { user_id: string; badge_type: string; contest_id: string }[] = [];
  const topDecile = ranked.length >= 10 ? Math.max(1, Math.ceil(ranked.length * 0.1)) : 0;
  ranked.forEach((entry, idx) => {
    if (idx === 0) awards.push({ user_id: entry.user_id, badge_type: "champion", contest_id: contest.id });
    else if (idx <= 2) awards.push({ user_id: entry.user_id, badge_type: "podium", contest_id: contest.id });
    if (topDecile > 0 && idx < topDecile && idx > 0)
      awards.push({ user_id: entry.user_id, badge_type: "top_10_pct", contest_id: contest.id });
  });

  if (awards.length > 0) {
    await admin.from("user_badges").upsert(awards, { onConflict: "user_id,badge_type,contest_id" });
  }

  await admin
    .from("contests")
    .update({ status: "final", resolved_at: new Date().toISOString() })
    .eq("id", contest.id);

  return { ranked: ranked.length, awarded: awards.length };
}
