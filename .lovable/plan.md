## Goal
Include flat-rate ("Buy It Now" / fixed-price) sold listings in the valuation, alongside auctions — so cards with few auction comps (like the Kodai Senga and Murakami cases) can still get accurate values.

## Change
In `src/lib/cardsight.server.ts`, remove the hard `listing_type=auction` filter on every Cardsight pricing call. Cardsight's pricing endpoint returns completed sales for both `auction` and `fixed_price` — the previous restriction was excluding legitimate sold BIN transactions.

We keep everything else that already works:
- Same 6-month window
- Same title-based filters (year, card number, auto, serial, parallel, grading)
- Same IQR outlier removal
- Same trimmed-median value basis
- Same 220ms throttle + backoff
- Same "no comps → mark as no comps / optional AI estimate" behavior

## Implementation details

1. **`fetchPricing` (and any fallback like `searchPricingComps`)**
   - Drop `listing_type: "auction"` from the query params so both auction and fixed-price completed sales are returned.
   - Keep any existing "sold/completed" flag if Cardsight requires it — we only widen the *listing type*, not the *sale status*. Active/unsold listings must still be excluded.

2. **Tag comps by sale type**
   - Preserve each comp's `listing_type` (`auction` | `fixed_price`) on the stored `recent_comparables` row so we can show it in the UI (e.g. "Auction" vs "BIN" chip next to each sale).

3. **UI: Recent Comparables table** (`src/routes/_authenticated/dashboard.tsx`)
   - Add a small type indicator next to each sale row ("Auction" / "BIN"). Link behavior unchanged.

4. **Revaluation trigger**
   - No change to the 30-day rule, but cards currently marked "no comps" will re-value on next load and likely pick up BIN sales now.

## Out of scope
- No change to median vs mean, filters, time window, grading logic, or parallel matching.
- No change to auth, MLB, or image pipeline.
