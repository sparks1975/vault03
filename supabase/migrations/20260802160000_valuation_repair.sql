-- Durable, cross-isolate cache for Cardsight REST responses. The app deploys
-- to an edge/Workers-style runtime where in-memory caches don't reliably
-- survive across requests; this table replaces that in-memory cache so the
-- same catalog/pricing lookup isn't re-billed on every cold isolate.
CREATE TABLE public.cardsight_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX cardsight_cache_expires_idx ON public.cardsight_cache (expires_at);
GRANT ALL ON public.cardsight_cache TO service_role;
ALTER TABLE public.cardsight_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (used exclusively by the server-side
-- Cardsight client) can read/write. Not exposed to anon/authenticated keys.

-- Negative-cache: when a card can't be matched to a Cardsight catalog entry,
-- record when that was last attempted so repeated triggers (auto-revalue,
-- "Re-value all", Manage Comps) don't re-pay the full resolution cascade for
-- a card that will very likely fail again.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS cardsight_lookup_failed_at timestamptz;

-- Marks a valuation attempt that produced no usable value (as opposed to a
-- successful valuation of $0). Lets the app distinguish "unvalued" from
-- "freshly valued at zero" and avoid masking failures as fresh for 30 days.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS last_valuation_failed_at timestamptz;
