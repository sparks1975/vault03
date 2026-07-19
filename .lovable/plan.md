## Problem

Our valuations are wrong because the current pipeline uses Cardsight's MCP `search_pricing` tool, which returns free-text eBay results only. We then regex-parse those strings and try to filter parallels/autos/grades after the fact. That has three failure modes:

- Only eBay comes back (MCP tool is eBay-scraped text). Cardsight's REST pricing endpoint returns multiple sources (`source` field on each record).
- Grade filtering is a substring guess — a raw card gets compared against PSA 10s and vice versa.
- Parallel/autograph filtering is regex keyword matching on titles, which leaks variants into base-card comps and inflates the range.

The REST API (`/v1/pricing/{card_id}`) is the correct surface: it takes a canonical `card_id`, a `parallel_id`, and a `grade_id`, and returns structured `raw` + `graded` sections with per-record `source`, `listing_type` (`auction`/`fixed`), price, and date.

## New valuation pipeline

Replace MCP-based pricing end-to-end with the REST API. Move to `https://api.cardsight.ai` using the same `CARDSIGHT_API_KEY` in an `X-API-Key` header.

1. **Identify → canonical `card_id`**
   - Replace MCP `identify_card` with `POST /v1/identify/card` (binary image upload).
   - Persist the returned canonical `card_id` on our `cards` row so we never re-identify to price.

2. **Resolve `parallel_id` and `grade_id`**
   - Bring back the parallel picker, scoped to the identified card's release only (via `/v1/catalog/cards/{card_id}` and `/v1/catalog/parallels`). Default = base (`parallel_id=null`).
   - Map our stored `grader` + `grade` (e.g. "PSA 10") to a Cardsight `grade_id` using `/v1/grades/companies` → `/types` → `/grades`. If the card is ungraded, pass `grade_id=null` (raw section).

3. **Fetch pricing**
   - `GET /v1/pricing/{card_id}?parallel_id=…&grade_id=…&period=6m&listing_type=auction`.
   - Pull the matching section: `raw` when ungraded, or the specific `graded[company][grade]` bucket when graded. No more title regex.

4. **Compute value (per user's choice: median, trimmed)**
   - Take only `listing_type === "auction"` records (completed sales).
   - Drop outliers with IQR (1.5×) when ≥5 records; require ≥3 records to publish a value, otherwise return `note` and fall back to the AI estimate as today.
   - `current_value = median(trimmed prices)`.
   - `value_delta_pct` = median of last 30 days vs. median of the prior 30 days (both from the same filtered stream), replacing today's AI-guessed delta.

5. **Sales list shown in UI**
   - Store up to 25 most-recent auction records with `source` (ebay / other), `sold_at`, `price`, `url`, `grade` label. This is what powers "Recent Comparables" and the sparkline, so non-eBay sources will finally appear when Cardsight has them.

## Schema

Add to `public.cards`:
- `cardsight_card_id uuid` — canonical Cardsight ID from identify.
- `cardsight_parallel_id uuid` — user-selected parallel (nullable = base).
- `cardsight_grade_id uuid` — resolved from `grader` + `grade` (nullable = raw).

No RLS changes; existing user-scoped policy covers new columns.

## Files

- `src/lib/cardsight.server.ts` — rewrite. Drop MCP `search_pricing` and the title-regex filter/rank stack. New helpers:
  - `identifyCardRest(bytes, contentType)` → `{ card_id, ...normalizedFields }`
  - `resolveGradeId(grader, grade)` with in-memory cache of the grades catalog
  - `listParallelsForCard(card_id)` scoped to the identified release
  - `fetchPricing(card_id, { parallel_id, grade_id, period })` returning the correct raw/graded bucket as `{ auctionSales, askListings }`
- `src/lib/ai.functions.ts` — `estimateCardValue` now takes `card_id`/`parallel_id`/`grade_id` and calls `fetchPricing`; applies median-of-trimmed-auctions and computes real `value_delta_pct`. AI call becomes a fallback only when comps are insufficient. `scanCardPhoto` switches to `identifyCardRest` and returns `card_id` alongside descriptor fields.
- `src/lib/cards.functions.ts` — extend `cardInputSchema` and `allowed` update list with the three new columns; `replaceValuation` unchanged in shape.
- `src/routes/_authenticated/dashboard.tsx` — re-add `ParallelSelect` (fed by `listParallelsForCard` using stored `cardsight_card_id`); wire the selection into add/edit; on save, pass `card_id`/`parallel_id`/`grade_id` to `estimateCardValue`. Update "Recent Comparables" to show the `source` per row.
- Migration — add three nullable UUID columns to `public.cards`.

## Out of scope

- No changes to auth, storage, TinyPNG, MLB enrichment, or unrelated UI.
- Fixed-price ("ask") listings are fetched but not blended into `current_value` per your choice; they can be surfaced later as a separate signal if you want.
