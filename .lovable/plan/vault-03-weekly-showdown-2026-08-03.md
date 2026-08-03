# Vault.03 Weekly Showdown

A weekly contest where every user enters a lineup of cards from their vault. Real MLB stats for those players during the week generate points, boosted by what makes each card special (rookie, auto, numbered, parallel). Everyone competes on one global leaderboard, and top finishers earn badges that show up on their public share page.

## The loop (v1, minimal)

1. **Monday** — a new contest opens automatically for the current MLB week (Mon–Sun).
2. **Enter** — from a "Showdown" section on the dashboard, the user picks 5 cards from their vault. Only cards with an identified MLB/MiLB player are eligible. One entry per user per contest; editable until first pitch Monday, locked after.
3. **Live scoring** — a nightly job pulls each rostered player's stats for the contest date range and recomputes every entry's score. Leaderboard updates daily.
4. **Sunday night** — the contest resolves, final standings are frozen, and badges are awarded.
5. **Badges** — appear on the dashboard and in a new "Badges" strip on the public share page (`/s/<slug>`).

## Scoring

**Player points** (from real MLB/MiLB stats for the contest week):

Hitting: single 1, double 2, triple 3, home run 4, RBI 1, run 1, walk 0.5, stolen base 1, strikeout −0.5.
Pitching: inning pitched 1, strikeout 1, win 3, save 2, earned run −1, hit allowed −0.25, walk allowed −0.25.

**Card multiplier** — the card's own attributes act as a boost on that player's points:

- Autographed +25%
- Numbered / serial +15%
- Parallel or refractor +15%
- Rookie card +10%
- First Bowman +10%
- Graded 9.5 or higher +10%

Multipliers stack additively, capped at +60% (so max 1.60x). A plain base card is 1.00x. This means a stacked card of a good week beats a base card of the same player — the collection matters, not just the player.

**Entry score** = sum of (player points x card multiplier) across the 5 cards.

Ties break by higher combined card multiplier, then earliest entry.

## Badges

Awarded at resolution, one per contest:

- **Champion** — 1st place
- **Podium** — 2nd or 3rd
- **Top 10%** — finished in the top decile (only when 10+ entries)
- **First Entry** — one-time, for a user's first ever contest entry

Badges are permanent rows with the contest week attached, so the share page can show "Champion — Week of Aug 3, 2026".

## UI

**Dashboard — new "Showdown" panel**
- Current contest state: open / locked / final, week dates, entry count.
- Lineup builder: 5 slots, pick from a filtered list of eligible vault cards (photo, player, year/set, badges, computed multiplier shown per card).
- Your entry's current score with a per-card breakdown once scoring starts.
- Global leaderboard: rank, display name, score, top-10 visible plus your own row if you're outside it.
- Your badge shelf.

**Public share page** — a badges strip under the owner header: badge icon, name, week. Nothing else changes.

Styling follows the existing collector-grade look with the deep-violet accent for the active/winning states; badge tiers use distinct restrained tones (champion gold-leaning, podium silver-leaning, top-10% violet).

## Technical notes

**Database (one migration, all with GRANTs + RLS)**

- `contests` — `week_start`, `week_end`, `status` (`open` | `locked` | `final`), `lock_at`, `resolved_at`. Public read (`anon` + `authenticated`), writes service-role only.
- `contest_entries` — `contest_id`, `user_id`, `score`, `submitted_at`, unique on (contest_id, user_id). Owner can insert/update while the contest is `open`; all authenticated users can read (needed for the leaderboard); `anon` read allowed so the share page can render standings.
- `contest_entry_cards` — `entry_id`, `card_id`, `player_points`, `multiplier`, `points`. Owner-scoped writes, same read model as entries.
- `user_badges` — `user_id`, `badge_type`, `contest_id`, `awarded_at`, unique on (user_id, badge_type, contest_id). Read by `anon`/`authenticated` (badges are public), writes service-role only.
- `profiles` gains no new columns; leaderboard names come from `display_name` via a server function using the admin client, exposing only display name and slug.

**Server functions** (`src/lib/showdown.functions.ts`, helpers in `showdown.server.ts`)

- `getCurrentContest` — public, returns contest + leaderboard (top 10) using the publishable/admin path, safe columns only.
- `getMyEntry` / `submitEntry` — `requireSupabaseAuth`; `submitEntry` validates exactly 5 cards, all owned by the caller, all with `mlb_player_id`, and rejects when the contest isn't `open`.
- `getMyBadges` — `requireSupabaseAuth`.
- `getPublicBadges` — public, by share slug, used by the share page loader.
- Multiplier math lives in a shared client-safe module (`src/lib/showdown-scoring.ts`) so the lineup builder can preview the same numbers the server computes.

**Scoring job** — new public route `src/routes/api/public/hooks/score-showdown.ts`, secret-header guarded like the existing 130point hook. It:
1. ensures a contest row exists for the current week (creates Monday's),
2. locks contests past `lock_at`,
3. fetches weekly stats per distinct rostered player from MLB StatsAPI (`people/{id}/stats?stats=byDateRange&startDate=&endDate=&group=hitting,pitching`, existing sportIds list), one call per player, cached in-run,
4. recomputes per-card and per-entry scores,
5. on the week's end, sets `status = final` and inserts badge rows.

Scheduled nightly via the same pg_cron pattern already used for the 130point refresh. No CardSight calls — this feature never touches the valuation pipeline or its API budget.

**Reads** — dashboard panel and share page use route loaders with `ensureQueryData` + `useSuspenseQuery`, matching current patterns; the share page loader calls only public server functions.
