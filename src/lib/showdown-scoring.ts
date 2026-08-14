// Shared, client-safe scoring math for the Weekly Showdown.
// Imported by both the lineup builder (preview) and the server scoring job so
// the numbers a user sees before submitting match what gets computed.

export const LINEUP_SIZE = 5;

export type ScorableCard = {
  is_autograph?: boolean | null;
  is_rookie?: boolean | null;
  is_first_bowman?: boolean | null;
  serial_number?: string | null;
  parallel?: string | null;
  grade?: string | null;
};

export type MultiplierBoost = { label: string; pct: number };

export const MULTIPLIER_CAP = 0.6;

/** Individual boosts a card earns, before the cap. */
export function cardBoosts(card: ScorableCard): MultiplierBoost[] {
  const boosts: MultiplierBoost[] = [];
  if (card.is_autograph) boosts.push({ label: "Auto", pct: 0.25 });
  if (card.serial_number && String(card.serial_number).trim() !== "")
    boosts.push({ label: "Numbered", pct: 0.15 });
  const parallel = (card.parallel ?? "").trim();
  if (parallel && !/^base$/i.test(parallel)) boosts.push({ label: "Parallel", pct: 0.15 });
  if (card.is_rookie) boosts.push({ label: "RC", pct: 0.1 });
  if (card.is_first_bowman) boosts.push({ label: "1st Bowman", pct: 0.1 });
  const grade = Number.parseFloat(String(card.grade ?? ""));
  if (Number.isFinite(grade) && grade >= 9.5) boosts.push({ label: "Gem grade", pct: 0.1 });
  return boosts;
}

/** Final multiplier, additive boosts capped at +60% (max 1.60x). */
export function cardMultiplier(card: ScorableCard): number {
  const raw = cardBoosts(card).reduce((sum, b) => sum + b.pct, 0);
  const capped = Math.min(raw, MULTIPLIER_CAP);
  return Math.round((1 + capped) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Player points
// ---------------------------------------------------------------------------

export type RawStats = Record<string, string | number | undefined>;

const num = (v: string | number | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Innings pitched come back as "12.2" meaning 12 innings + 2 outs. */
function inningsToNumber(v: string | number | undefined): number {
  if (v == null) return 0;
  const s = String(v);
  const [whole, frac] = s.split(".");
  const outs = frac ? Number.parseInt(frac[0] ?? "0", 10) : 0;
  return (Number.parseInt(whole || "0", 10) || 0) + (Number.isFinite(outs) ? outs / 3 : 0);
}

export function hittingPoints(s: RawStats): number {
  const hits = num(s.hits);
  const doubles = num(s.doubles);
  const triples = num(s.triples);
  const hr = num(s.homeRuns);
  const singles = Math.max(0, hits - doubles - triples - hr);
  return (
    singles * 1 +
    doubles * 2 +
    triples * 3 +
    hr * 4 +
    num(s.rbi) * 1 +
    num(s.runs) * 1 +
    num(s.baseOnBalls) * 0.5 +
    num(s.stolenBases) * 1 +
    num(s.strikeOuts) * -0.5
  );
}

export function pitchingPoints(s: RawStats): number {
  return (
    inningsToNumber(s.inningsPitched) * 1 +
    num(s.strikeOuts) * 1 +
    num(s.wins) * 3 +
    num(s.saves) * 2 +
    num(s.earnedRuns) * -1 +
    num(s.hits) * -0.25 +
    num(s.baseOnBalls) * -0.25
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Stat lines (what generated a card's score)
// ---------------------------------------------------------------------------

/** Weekly stat totals stored alongside each scored lineup card. */
export type StatLine = {
  hitting?: RawStats | null;
  pitching?: RawStats | null;
};

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Human-readable stat chips, e.g. "2-for-8 · 1 HR · 3 RBI". */
export function statLineParts(stats?: StatLine | null): string[] {
  if (!stats) return [];
  const parts: string[] = [];
  const h = stats.hitting;
  if (h) {
    const ab = num(h.atBats);
    const hits = num(h.hits);
    if (ab > 0 || hits > 0) parts.push(`${fmtNum(hits)}-for-${fmtNum(ab)}`);
    if (num(h.doubles) > 0) parts.push(`${fmtNum(num(h.doubles))} 2B`);
    if (num(h.triples) > 0) parts.push(`${fmtNum(num(h.triples))} 3B`);
    if (num(h.homeRuns) > 0) parts.push(`${fmtNum(num(h.homeRuns))} HR`);
    if (num(h.rbi) > 0) parts.push(`${fmtNum(num(h.rbi))} RBI`);
    if (num(h.runs) > 0) parts.push(`${fmtNum(num(h.runs))} R`);
    if (num(h.baseOnBalls) > 0) parts.push(`${fmtNum(num(h.baseOnBalls))} BB`);
    if (num(h.stolenBases) > 0) parts.push(`${fmtNum(num(h.stolenBases))} SB`);
    if (num(h.strikeOuts) > 0) parts.push(`${fmtNum(num(h.strikeOuts))} K`);
  }
  const p = stats.pitching;
  if (p) {
    const ip = num(p.inningsPitched);
    if (ip > 0) parts.push(`${p.inningsPitched} IP`);
    if (num(p.strikeOuts) > 0) parts.push(`${fmtNum(num(p.strikeOuts))} K`);
    if (num(p.wins) > 0) parts.push(`${fmtNum(num(p.wins))} W`);
    if (num(p.saves) > 0) parts.push(`${fmtNum(num(p.saves))} SV`);
    if (num(p.earnedRuns) > 0) parts.push(`${fmtNum(num(p.earnedRuns))} ER`);
    if (num(p.hits) > 0) parts.push(`${fmtNum(num(p.hits))} H`);
    if (num(p.baseOnBalls) > 0) parts.push(`${fmtNum(num(p.baseOnBalls))} BB`);
  }
  return parts;
}

export function hasStatLine(stats?: StatLine | null): boolean {
  return !!stats && (!!stats.hitting || !!stats.pitching);
}


// ---------------------------------------------------------------------------
// Contest weeks (Monday -> Sunday, UTC dates)
// ---------------------------------------------------------------------------

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `ref` (UTC). */
export function weekStart(ref: Date = new Date()): Date {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function weekEnd(start: Date): Date {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

/**
 * Lineups stay open for the whole contest week — they lock when the week ends
 * (Monday 00:00 UTC after the final Sunday).
 */
export function lockAt(start: Date): Date {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}


export function formatWeekLabel(weekStartIso: string): string {
  const d = new Date(`${weekStartIso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeType = "champion" | "podium" | "top_10_pct" | "first_entry";

export const BADGE_META: Record<BadgeType, { label: string; blurb: string; tone: string }> = {
  champion: {
    label: "Champion",
    blurb: "1st place",
    tone: "bg-amber-400/15 text-amber-300 border-amber-400/40",
  },
  podium: {
    label: "Podium",
    blurb: "Top 3 finish",
    tone: "bg-zinc-300/15 text-zinc-200 border-zinc-300/40",
  },
  top_10_pct: {
    label: "Top 10%",
    blurb: "Finished in the top decile",
    tone: "bg-accent/20 text-accent-foreground border-accent/50",
  },
  first_entry: {
    label: "First Entry",
    blurb: "Played their first Showdown",
    tone: "bg-secondary text-foreground border-border",
  },
};

export function badgeMeta(type: string) {
  return (
    BADGE_META[type as BadgeType] ?? {
      label: type,
      blurb: "",
      tone: "bg-secondary text-foreground border-border",
    }
  );
}
