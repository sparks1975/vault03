import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// MLB Stats API — free, public, no key required.
// Docs: https://statsapi.mlb.com/

export interface PlayerStatBlock {
  player: { id: number; name: string; team?: string; position?: string; primaryNumber?: string } | null;
  season: string;
  group: "hitting" | "pitching" | null;
  stats: Record<string, string | number> | null;
}

async function json(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MLB API ${res.status}`);
  return res.json();
}

export const searchMlbPlayer = createServerFn({ method: "GET" })
  .inputValidator((d: { query: string }) => z.object({ query: z.string().min(2).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(data.query)}&sportIds=1`;
    const body = await json(url);
    const people = (body.people ?? []) as Array<{
      id: number;
      fullName: string;
      primaryPosition?: { abbreviation?: string };
      currentTeam?: { name?: string };
      active?: boolean;
    }>;
    return people.slice(0, 8).map((p) => ({
      id: p.id,
      name: p.fullName,
      team: p.currentTeam?.name ?? null,
      position: p.primaryPosition?.abbreviation ?? null,
      active: p.active ?? false,
    }));
  });

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

    // Retired players → return career totals.
    if (!isActive) {
      const careerUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=career&group=${group}&sportId=1`;
      const body = await json(careerUrl);
      const splits = body.stats?.[0]?.splits ?? [];
      if (splits.length > 0) {
        return {
          player: buildPlayer(),
          season: "Career",
          group,
          stats: splits[splits.length - 1].stat ?? null,
        };
      }
    }

    // Active players (or fallback) → try current season, then prior season.
    for (const s of [season, String(Number(season) - 1)]) {
      const statsUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=season&group=${group}&season=${s}&sportId=1`;
      const body = await json(statsUrl);
      const splits = body.stats?.[0]?.splits ?? [];
      if (splits.length > 0) {
        return {
          player: buildPlayer(),
          season: s,
          group,
          stats: splits[0].stat ?? null,
        };
      }
    }

    // Last resort: career stats even for active players with no season data.
    const careerUrl = `https://statsapi.mlb.com/api/v1/people/${data.playerId}/stats?stats=career&group=${group}&sportId=1`;
    const careerBody = await json(careerUrl).catch(() => null);
    const careerSplits = careerBody?.stats?.[0]?.splits ?? [];
    if (careerSplits.length > 0) {
      return {
        player: buildPlayer(),
        season: "Career",
        group,
        stats: careerSplits[careerSplits.length - 1].stat ?? null,
      };
    }

    return { player: buildPlayer(), season, group, stats: null };
  });

