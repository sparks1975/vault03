## Goal
Add 130point.com sold-sales data as a second comp source, merged with Cardsight, refreshed nightly. Cards previously stuck on "no comps" (Kodai Senga, Murakami, etc.) will get a real median instead of an AI estimate.

## Approach
Firecrawl connector (handles 130point's Cloudflare) → nightly pg_cron job → per-card scrape → cached results merged into the same median/IQR pipeline as Cardsight.

## Steps

### 1. Connector + secret
- Connect the Firecrawl connector (`standard_connectors--connect`). This provisions `FIRECRAWL_API_KEY` and (if gateway-backed) `LOVABLE_API_KEY` for server use.

### 2. Schema — new `pt130_comps` table
Migration adds one table to cache scraped comps per card:

```
pt130_comps(
  id uuid pk,
  card_id uuid fk cards(id) on delete cascade,
  user_id uuid not null,
  sold_at date,
  price numeric not null,
  title text,
  url text,
  listing_type text,        -- 'auction' | 'bin' | null
  scraped_at timestamptz default now()
)
```
Plus RLS (owner-only), GRANTs, and index on `(card_id, sold_at desc)`.

### 3. 130point scraper — `src/lib/pt130.server.ts`
- Build a query string from card fields (year + set + player + `#number` + grade if graded).
- Call Firecrawl `/v2/scrape` on `https://back.130point.com/sales/?query=<encoded>` (the JSON endpoint their search page uses) with `formats: ['markdown','html']`, `onlyMainContent: true`, small `waitFor`.
- Parse the sold-sales rows out of the returned HTML/markdown: title, price, sold date, listing URL, auction vs BIN.
- Return normalized `{ sold_at, price, title, url, listing_type }[]`, filtered to the last 6 months and to titles that pass the same variant filters we already use for Cardsight (year, card #, auto, serial, parallel, grading tokens).

### 4. Nightly batch — `src/routes/api/public/hooks/refresh-130point.ts`
- `POST` handler protected by `apikey` header (Supabase anon key), per project cron pattern.
- Loads every card in `cards` (all users), throttled ~1 req/sec to be polite to Firecrawl + 130point.
- For each card: scrape → replace that card's rows in `pt130_comps` (delete + insert) using `supabaseAdmin` (loaded inside the handler).
- Skip cards updated in the last 20 hours to make the job resumable.
- pg_cron entry (via `supabase--insert`, not migration) schedules it daily at 08:00 UTC hitting the stable `project--{id}.lovable.app` URL.

### 5. Merge into valuation — `src/lib/ai.functions.ts`
Inside `estimateCardValue`, after the existing Cardsight comp collection:
- Read `pt130_comps` for this card via `context.supabase` (RLS-scoped) in `_authenticated` server fn — same user only.
- Merge Cardsight comps + 130point comps into one array before running `trimOutliersIQR` + `median`.
- Tag each merged comp with `source` (`Cardsight (...)` or `130point`) and preserve `listing_type` so the Recent Comparables table still shows Auction/BIN chips and links.
- Note behavior: if a card had 0 Cardsight comps but 130point returns ≥3, it now values from 130point instead of falling back to AI. `compsNote` reflects which source(s) were used.

### 6. UI — `src/routes/_authenticated/dashboard.tsx`
- Recent Comparables rows already render source + link; add `130point` as an accepted source label and link.
- No new controls.

## Out of scope
- No live/on-demand 130point calls in the request path (nightly cache only).
- No change to Cardsight query params, IQR window, 30-day revaluation, or MLB/photo pipelines.
- No manual/CSV import path.

## Technical notes
- 130point's public search page is Cloudflare-protected; the JSON `back.130point.com/sales/?query=` endpoint is what their frontend hits and is what Firecrawl will render.
- Firecrawl gateway vs direct-API mode is per-connection — the scraper will read `uses_connector_gateway` from the connect result and pick the right auth headers (already documented in project knowledge).
- All scraping runs server-side only; no keys exposed to browser.
- pg_cron uses the stable `project--06175a94-...lovable.app` URL so it survives renames.
