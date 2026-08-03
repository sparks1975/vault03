-- contest_entries: remove public read, scope to owner
DROP POLICY IF EXISTS "Entries are publicly readable" ON public.contest_entries;
REVOKE ALL ON public.contest_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contest_entries TO authenticated;
GRANT ALL ON public.contest_entries TO service_role;
CREATE POLICY "Users read own entries"
  ON public.contest_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- contest_entry_cards: remove public read, scope to owner
DROP POLICY IF EXISTS "Entry cards are publicly readable" ON public.contest_entry_cards;
REVOKE ALL ON public.contest_entry_cards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contest_entry_cards TO authenticated;
GRANT ALL ON public.contest_entry_cards TO service_role;

-- user_badges: remove public read, scope to owner (public pages use backend service role)
DROP POLICY IF EXISTS "Badges are publicly readable" ON public.user_badges;
REVOKE ALL ON public.user_badges FROM anon;
GRANT SELECT ON public.user_badges TO authenticated;
GRANT ALL ON public.user_badges TO service_role;
CREATE POLICY "Users read own badges"
  ON public.user_badges FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- cardsight_cache: backend-only cache, no client access by design
ALTER TABLE public.cardsight_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cardsight_cache FROM anon, authenticated;
GRANT ALL ON public.cardsight_cache TO service_role;
COMMENT ON TABLE public.cardsight_cache IS 'Backend-only response cache. RLS enabled with no policies intentionally: accessed exclusively by server code via the service role; anon/authenticated have no grants.';