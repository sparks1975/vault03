ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS last_valuation_failed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cardsight_lookup_failed_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS public.cardsight_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.cardsight_cache TO service_role;

ALTER TABLE public.cardsight_cache ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS cardsight_cache_expires_at_idx ON public.cardsight_cache (expires_at);