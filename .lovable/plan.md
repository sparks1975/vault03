# Switch eBay comps back to caffein.dev (cost-optimized)

## Why it was $0.80/card before

The previous caffein.dev version used the **default `count` of 100** results per keyword, and sent **2 descriptors per card** (with and without card number). That's ~200 results per card at ~$4/1000 results = **$0.80/card**.

## How to make it cheap

The actor is **paid per result** (~$2.50–$4 per 1,000 results, depending on your Apify plan). Cost scales linearly with `keywords × count`. Two levers cut it 10x:

| Lever | Before | After | Savings |
|-------|--------|-------|---------|
| Descriptors per card | 2 (with + without card #) | 1 (primary only) | 2x |
| `count` (max results per keyword) | 100 (default) | 20 | 5x |
| **Results per card** | **200** | **20** | **10x** |

**Approximate cost per card:**
- At $2.50/1k results: **$0.05/card**
- At $4.00/1k results: **$0.08/card**
- 41-card nightly refresh: **~$2–$3/night** (down from ~$33/night)

20 sold listings is plenty for an IQR-trimmed median — we only need ~8–12 clean comps after filtering.

## Changes

### 1. `src/lib/pt130.server.ts` — switch actor + params

- **ACTOR_ID** → `caffein.dev~ebay-sold-listings`
- **Request body** params remapped to caffein.dev's schema:
  - `searchQueries` → `keywords`
  - `maxItemsPerQuery` → `count` (set to **20**)
  - `soldWithinDays` → `daysToScrape` (keep 90)
  - `sort` → `sortOrder: "endedRecently"`
  - Add `categoryId: "26376"` (eBay Baseball Cards category — improves match quality at the source, filters out boxes/lots/non-baseball before they reach our result count)
  - Add `includeCompletedListings: true` (enables accurate Best Offer detection)
- **Response parsing** remapped to caffein.dev's field names:
  - `soldPrice` → same (string, cast to Number)
  - `soldCurrency` → currency check (was `currency`)
  - `endedAt` → `sold_at` (was `saleEndDate`)
  - `url` → `url` (was `itemUrl`)
  - `thumbnailUrl` → `image_url` (was `imageUrl`)
  - `listingType` → normalize (values are `buy_it_now`, `auction`; plus `isBestOfferAccepted` boolean for best-offer detection)
- **Remove** the "summary row" filter (`if (item.type && item.type !== "item") continue`) — caffein.dev doesn't emit summary rows.
- **RESULTS_PER_SEARCH** constant → 20 (was 40).

### 2. `buildPt130Descriptors` — return primary only

Change `buildPt130Descriptors` to return **only the primary descriptor** (with card number). The "without card number" fallback was doubling result count and adding noise. If the primary descriptor returns too few results, the Cardsight API path already handles valuation as a fallback.

### 3. Nightly refresh — batch 6 cards per run (optional cost saver)

The actor accepts up to 6 keywords per run, and each result includes a `keyword` field identifying which search it came from. Batch 6 cards into a single run to reduce API calls from 41 to ~7. Same per-result cost, but fewer runs and less overhead. Results are mapped back to cards using the `keyword` field.

This is a secondary optimization — the main savings come from count=20 + 1 descriptor.

## What stays the same

- The `pt130_comps` cache table schema (no migration needed)
- The 30-day revaluation cycle
- The `Pt130Sale` return type and all downstream valuation logic
- Manual comp override (`ManageCompsDialog`)
- The nightly cron hook route (`/api/public/hooks/refresh-130point`)
