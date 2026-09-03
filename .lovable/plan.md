# Rebuild valuation: fast, accurate, and always visible

## What's actually wrong (verified)

1. **The search asks the wrong question.** For your `2025 Bowman Chrome Max Volume #MV-1 Roki Sasaki`, the eBay sold search included the parallel words ("Mini Diamond Refractor"). eBay ranks on those words, so 80 stored results came back — almost all of them *other players'* Mini-Diamond cards (Walker Jenkins, Ethan Salas, Arjun Nimmala). Only 2 were actually this card.
2. **So the matcher looks broken when it isn't.** The strict checker correctly rejects those 78 wrong-player listings, so the screen shows almost no comparables and a "nothing matched" note. Garbage in, nothing out.
3. **It's slow because we scrape up to three times per card.** Each valuation can launch three separate eBay scraper runs, each started and then polled for up to 4 minutes, 40 results each. Three broad searches that mostly return noise is the entire slowness.
4. **The accurate, fast source is being used last.** When a card is linked to the catalog (80 of your 147 cards are), a single structured pricing request returns sales already scoped to that exact card, parallel, and grade. Today that only runs if the scrape found nothing.

## The new approach

**Ask the precise question once, show everything that comes back, value only from clean matches.**

### 1. Catalog pricing first
When a card has a catalog link, use the structured pricing request as the primary source: one call, already scoped to card + parallel + grade. Fast and inherently accurate — no title guessing. Only fall through to eBay scraping when there's no catalog link or no sales on the catalog card.

### 2. One well-formed eBay search, not three
- Build the query from identity only: year, product, card number, player name. Parallel/finish words and the serial denominator come out of the *search* (they hijack eBay relevance) but stay in *verification*.
- Exactly one scraper run per valuation. Poll starting at ~1s with ~2s intervals and a hard 45s ceiling instead of 4 minutes.
- Reuse a cache newer than 24h when it already contains matching comps.
- A "Broaden search" action in Manage Comps runs the looser brand-only / no-card-number searches on demand, so the extra cost and wait only happen when you ask.

### 3. Never hide the results again
The comparables panel always renders what the sources returned, in two groups:
- **Used for value** — verified matches for this exact card; the trimmed median of these sets the value (unchanged).
- **Other sales returned (not used)** — every remaining listing, each tagged with the reason it was excluded ("different player", "different card number", "graded", "parallel mismatch", "lot/box").

That turns today's silent dead end into something you can see and correct — and lets you promote any listing to a real comp from the same list.

### 4. Flag identity mismatches instead of searching the wrong card
When the saved year/set disagrees with the linked catalog card (exactly the case on the MV-1 card, saved as `2024 Bowman Chrome`), show a "Card details disagree with catalog — review" prompt on the card rather than quietly running a search that cannot succeed.

### 5. Clean up the poisoned cache
Purge stored comps that fail identity verification for their card, so the panel isn't back-filled with the wrong-player results already in the database.

## Technical notes

- `src/lib/ai.functions.ts` — invert `ebaySoldPass` / `cardsightPass` ordering: run catalog pricing first when `cardsight_card_id` exists; eBay only as fallback. Remove the three-tier scrape cascade; keep a single primary-tier search plus an explicit broaden path.
- `src/lib/pt130.server.ts` — descriptors drop parallel/serial/auto terms from the eBay keyword (`includeTraits: false` for search) while `scoreCompTitle` keeps enforcing them; poll interval 1s/2s, deadline 45s; results per search stays 40.
- `src/lib/cardsight.server.ts` — `scoreCompTitle` returns a stable machine reason code alongside the level so the UI can label exclusions; matching rules themselves stay as they are.
- `src/lib/cards.functions.ts` — comp fetch returns all rows with `level` + `reason` instead of pre-filtering; add a purge of non-matching cached rows on revalue.
- `src/routes/_authenticated/_approved/vault.tsx` — two-group comparables list with reason chips, catalog-disagreement banner, "Broaden search" in Manage Comps.
- Extend `src/lib/comp-matching.test.ts`: assert search keywords exclude parallel/serial terms, that verification still rejects wrong-player/wrong-number titles, and add the MV-1 case as a regression fixture.

## Validation

- Re-value the MV-1 Sasaki card and confirm the search returns Max Volume MV-1 sales, a value is set, and excluded listings are visible with reasons.
- Re-value a graded card and a parallel/auto card; confirm value basis and labels.
- Confirm a single valuation makes one scraper run and completes well under the old multi-minute path.
- Full test suite and build pass.
