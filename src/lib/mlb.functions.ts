import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// MLB Stats API — free, public, no key required. Covers MLB (sportId=1) and
// MiLB affiliates (11 AAA, 12 AA, 13 High-A, 14 A, 16 Rookie).
// Docs: https://statsapi.mlb.com/

const SPORT_IDS = [1, 11, 12, 13, 14, 16] as const;
const SPORT_IDS_PARAM = SPORT_IDS.join(",");

export interface PlayerStatBlock {
  player: {
    id: number;
    name: string;
    team?: string;
    position?: string;
    primaryNumber?: string;
  } | null;
  season: string;
  group: "hitting" | "pitching" | null;
  league: string | null; // e.g. "MLB", "AAA", "AA"
  stats: Record<string, string | number> | null;
}

async function json(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MLB API ${res.status}`);
  return res.json();
}

function sportLabel(sportId?: number, leagueName?: string): string | null {
  switch (sportId) {
    case 1:
      return "MLB";
    case 11:
      return "AAA";
    case 12:
      return "AA";
    case 13:
      return "High-A";
    case 14:
      return "A";
    case 16:
      return "Rookie";
    default:
      return leagueName ?? null;
  }
}

export const searchMlbPlayer = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) =>
    z.object({ query: z.string().min(2).max(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(
      data.query,
    )}&sportIds=${SPORT_IDS_PARAM}`;
    const body = await json(url);
    const people = (body.people ?? []) as Array<{
      id: number;
      fullName: string;
      primaryPosition?: { abbreviation?: string };
      currentTeam?: { name?: string };
      active?: boolean;
    }>;
    // Dedupe by id (same player can surface across multiple sportIds).
    const seen = new Set<number>();
    const unique = people.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
    return unique.slice(0, 12).map((p) => ({
      id: p.id,
      name: p.fullName,
      team: p.currentTeam?.name ?? null,
      position: p.primaryPosition?.abbreviation ?? null,
      active: p.active ?? false,
    }));
  });

type Split = {
  season?: string;
  stat?: Record<string, string | number>;
  team?: { name?: string };
  league?: { name?: string };
  sport?: { id?: number; name?: string };
};

// Pick the best split from a set: prefer highest level (MLB > AAA > AA > ...).
function pickBestSplit(splits: Split[]): Split | null {
  if (!splits.length) return null;
  const rank = (id?: number) => {
    const idx = SPORT_IDS.indexOf(id as (typeof SPORT_IDS)[number]);
    return idx === -1 ? 99 : idx;
  };
  return [...splits].sort((a, b) => rank(a.sport?.id) - rank(b.sport?.id))[0];
}

export const getPlayerStats = createServerFn({ method: "GET" })
  .inputValidator((d: { playerId: number }) =>
    z.object({ playerId: z.number().int().positive() }).parse(d),
  )
  .handler(async ({ data }): Promise<PlayerStatBlock> => {
    const season = new Date().getUTCFullYear().toString();
    const personUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}`;
    const person = (await json(personUrl)).people?.[0];
    const position = person?.primaryPosition?.abbreviation as string | undefined;
    const isPitcher = position === "P";
    const group = isPitcher ? "pitching" : "hitting";
    const isActive = person?.active ?? false;

    const buildPlayer = () =>
      person
        ? {
            id: data.playerId,
            name: person.fullName,
            team: person.currentTeam?.name ?? undefined,
            position,
            primaryNumber: person.primaryNumber ?? undefined,
          }
        : null;

    const build = (split: Split, seasonLabel: string): PlayerStatBlock => ({
      player: buildPlayer(),
      season: seasonLabel,
      group,
      league: sportLabel(split.sport?.id, split.league?.name),
      stats: split.stat ?? null,
    });

    // Retired players → career totals (try MLB, then MiLB).
    if (!isActive) {
      for (const sid of SPORT_IDS) {
        const careerUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=career&group=${group}&sportId=${sid}`;
        const body = await json(careerUrl).catch(() => null);
        const splits = (body?.stats?.[0]?.splits ?? []) as Split[];
        if (splits.length > 0) {
          const s = splits[splits.length - 1];
          s.sport = s.sport ?? { id: sid };
          return build(s, "Career");
        }
      }
    }

    // Active players → try current, then prior season across MLB + MiLB combined.
    for (const s of [season, String(Number(season) - 1)]) {
      const statsUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=season&group=${group}&season=${s}&sportIds=${SPORT_IDS_PARAM}`;
      const body = await json(statsUrl).catch(() => null);
      const splits = (body?.stats?.[0]?.splits ?? []) as Split[];
      const best = pickBestSplit(splits);
      if (best) return build(best, s);
    }

    // Last resort: career across all levels.
    for (const sid of SPORT_IDS) {
      const careerUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=career&group=${group}&sportId=${sid}`;
      const body = await json(careerUrl).catch(() => null);
      const splits = (body?.stats?.[0]?.splits ?? []) as Split[];
      if (splits.length > 0) {
        const s = splits[splits.length - 1];
        s.sport = s.sport ?? { id: sid };
        return build(s, "Career");
      }
    }

    return { player: buildPlayer(), season, group, league: null, stats: null };
  });
