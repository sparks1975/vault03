import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LINEUP_SIZE, cardMultiplier, type StatLine } from "@/lib/showdown-scoring";

export type LeaderboardRow = {
  rank: number;
  user_id: string;
  display_name: string;
  share_slug: string | null;
  score: number;
  is_me?: boolean;
};

export const getCurrentShowdown = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ensureCurrentContest, ensureEntryContest } = await import("@/lib/showdown.server");

  const contest = await ensureCurrentContest(supabaseAdmin as never);
  const entryContest = await ensureEntryContest(supabaseAdmin as never, contest);


  const { data: entries, error } = await supabaseAdmin
    .from("contest_entries")
    .select("id, user_id, score, multiplier_total, submitted_at")
    .eq("contest_id", contest.id);
  if (error) throw error;

  const sorted = [...(entries ?? [])].sort((a, b) => {
    const d = Number(b.score) - Number(a.score);
    if (d !== 0) return d;
    const m = Number(b.multiplier_total) - Number(a.multiplier_total);
    if (m !== 0) return m;
    return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
  });

  const ids = sorted.map((e) => e.user_id);
  const names = new Map<string, { display_name: string | null; share_slug: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, share_slug")
      .in("id", ids);
    for (const p of profiles ?? [])
      names.set(p.id, { display_name: p.display_name, share_slug: p.share_slug });
  }

  const leaderboard: LeaderboardRow[] = sorted.map((e, i) => ({
    rank: i + 1,
    user_id: e.user_id,
    display_name: names.get(e.user_id)?.display_name || "Collector",
    share_slug: names.get(e.user_id)?.share_slug ?? null,
    score: Number(e.score),
  }));

  return {
    contest: {
      id: contest.id,
      week_start: contest.week_start,
      week_end: contest.week_end,
      lock_at: contest.lock_at,
      status: contest.status,
    },
    entry_contest: {
      id: entryContest.id,
      week_start: entryContest.week_start,
      week_end: entryContest.week_end,
      lock_at: entryContest.lock_at,
      status: entryContest.status,
      is_current: entryContest.id === contest.id,
    },
    entry_count: leaderboard.length,
    leaderboard,
  };

});

export const getMyShowdownEntry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contest_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: entry, error } = await supabase
      .from("contest_entries")
      .select("id, score, multiplier_total, submitted_at")
      .eq("contest_id", data.contest_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!entry) return { entry: null, cards: [] as never[] };

    const { data: cards, error: cErr } = await supabase
      .from("contest_entry_cards")
      .select("card_id, mlb_player_id, player_points, multiplier, points")
      .eq("entry_id", entry.id);
    if (cErr) throw cErr;

    return {
      entry: {
        id: entry.id,
        score: Number(entry.score),
        multiplier_total: Number(entry.multiplier_total),
        submitted_at: entry.submitted_at,
      },
      cards: (cards ?? []).map((c) => ({
        card_id: c.card_id,
        mlb_player_id: c.mlb_player_id,
        player_points: Number(c.player_points),
        multiplier: Number(c.multiplier),
        points: Number(c.points),
      })),
    };
  });

export const getShowdownLineup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ contest_id: z.string().uuid(), user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchPlayerWeekStats } = await import("@/lib/showdown.server");

    const { data: entry, error } = await supabaseAdmin
      .from("contest_entries")
      .select("id, score")
      .eq("contest_id", data.contest_id)
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (error) throw error;
    if (!entry)
      return {
        cards: [] as {
          player_name: string;
          detail: string;
          multiplier: number;
          player_points: number;
          points: number;
          stats: StatLine | null;
        }[],
      };

    const { data: contest, error: contestErr } = await supabaseAdmin
      .from("contests")
      .select("week_start, week_end")
      .eq("id", data.contest_id)
      .single();
    if (contestErr) throw contestErr;

    const { data: rows, error: cErr } = await supabaseAdmin
      .from("contest_entry_cards")
      .select("id, card_id, mlb_player_id, player_points, multiplier, points, stats")
      .eq("entry_id", entry.id);
    if (cErr) throw cErr;

    const statCache = new Map<number, StatLine | null>();
    for (const row of rows ?? []) {
      if (row.stats || typeof row.mlb_player_id !== "number") continue;
      let stats = statCache.get(row.mlb_player_id);
      if (stats === undefined) {
        stats = (await fetchPlayerWeekStats(
          row.mlb_player_id,
          contest.week_start,
          contest.week_end,
        )).stats;
        statCache.set(row.mlb_player_id, stats);
      }
      if (stats) {
        row.stats = stats as never;
        await supabaseAdmin
          .from("contest_entry_cards")
          .update({ stats: stats as never })
          .eq("id", row.id);
      }
    }

    const cardIds = (rows ?? []).map((r) => r.card_id);
    const meta = new Map<string, { player_name: string; detail: string }>();
    if (cardIds.length > 0) {
      const { data: cards } = await supabaseAdmin
        .from("cards")
        .select("id, player_name, year, set_name, card_number, parallel")
        .in("id", cardIds);
      for (const c of cards ?? [])
        meta.set(c.id, {
          player_name: c.player_name ?? "Unknown player",
          detail: [c.year, c.set_name, c.card_number ? `#${c.card_number}` : null, c.parallel]
            .filter(Boolean)
            .join(" · "),
        });
    }

    return {
      cards: (rows ?? [])
        .map((r) => ({
          player_name: meta.get(r.card_id)?.player_name ?? "Unknown player",
          detail: meta.get(r.card_id)?.detail ?? "",
          multiplier: Number(r.multiplier),
          player_points: Number(r.player_points),
          points: Number(r.points),
          stats: (r.stats ?? null) as StatLine | null,
        }))
        .sort((a, b) => b.points - a.points),
    };
  });

export const submitShowdownEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contest_id: z.string().uuid(),
        card_ids: z.array(z.string().uuid()).length(LINEUP_SIZE),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: contest, error: contestErr } = await supabase
      .from("contests")
      .select("id, status, lock_at")
      .eq("id", data.contest_id)
      .maybeSingle();
    if (contestErr) throw contestErr;
    if (!contest) throw new Error("Contest not found.");
    if (contest.status !== "open" || new Date(contest.lock_at).getTime() <= Date.now()) {
      throw new Error("Lineups for this week are locked.");
    }

    const unique = Array.from(new Set(data.card_ids));
    if (unique.length !== LINEUP_SIZE) throw new Error("Each card can only be used once.");

    const { data: cards, error: cardsErr } = await supabase
      .from("cards")
      .select(
        "id, player_name, mlb_player_id, is_autograph, is_rookie, is_first_bowman, serial_number, parallel, grade",
      )
      .eq("user_id", userId)
      .in("id", unique);
    if (cardsErr) throw cardsErr;
    if ((cards ?? []).length !== LINEUP_SIZE) throw new Error("One or more cards aren't in your vault.");
    const ineligible = (cards ?? []).filter((c) => !c.mlb_player_id);
    if (ineligible.length > 0) {
      throw new Error(
        `These cards need an identified player before they can play: ${ineligible
          .map((c) => c.player_name)
          .join(", ")}`,
      );
    }

    const { data: entry, error: upErr } = await supabase
      .from("contest_entries")
      .upsert(
        { contest_id: contest.id, user_id: userId, submitted_at: new Date().toISOString() },
        { onConflict: "contest_id,user_id" },
      )
      .select("id")
      .single();
    if (upErr) throw upErr;

    await supabase.from("contest_entry_cards").delete().eq("entry_id", entry.id);

    const rows = (cards ?? []).map((c) => ({
      entry_id: entry.id,
      card_id: c.id,
      user_id: userId,
      mlb_player_id: c.mlb_player_id,
      multiplier: cardMultiplier(c),
    }));
    const { error: insErr } = await supabase.from("contest_entry_cards").insert(rows);
    if (insErr) throw insErr;

    // First-ever entry badge (service role — badges are backend-awarded only).
    const { count } = await supabase
      .from("contest_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) <= 1) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("user_badges")
        .upsert(
          { user_id: userId, badge_type: "first_entry", contest_id: contest.id },
          { onConflict: "user_id,badge_type,contest_id" },
        );
    }

    return { entry_id: entry.id };
  });

export const getMyBadges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_badges")
      .select("id, badge_type, awarded_at, contest_id, contests(week_start)")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((b) => ({
      id: b.id,
      badge_type: b.badge_type,
      awarded_at: b.awarded_at,
      week_start:
        (b as unknown as { contests?: { week_start?: string } | null }).contests?.week_start ?? null,
    }));
  });

export const getPublicBadges = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slug = data.slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, is_public")
      .eq("share_slug", slug)
      .maybeSingle();
    if (!profile || !profile.is_public) return [];

    const { data: badges } = await supabaseAdmin
      .from("user_badges")
      .select("id, badge_type, awarded_at, contests(week_start)")
      .eq("user_id", profile.id)
      .order("awarded_at", { ascending: false });

    return (badges ?? []).map((b) => ({
      id: b.id,
      badge_type: b.badge_type,
      awarded_at: b.awarded_at,
      week_start:
        (b as unknown as { contests?: { week_start?: string } | null }).contests?.week_start ?? null,
    }));
  });
