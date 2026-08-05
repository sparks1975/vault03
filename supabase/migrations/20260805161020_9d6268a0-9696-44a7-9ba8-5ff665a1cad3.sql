-- cardsight_cache: internal server-only cache. Make deny-for-clients explicit.
REVOKE ALL ON public.cardsight_cache FROM anon, authenticated;
GRANT ALL ON public.cardsight_cache TO service_role;
ALTER TABLE public.cardsight_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardsight_cache FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to cardsight cache" ON public.cardsight_cache;
CREATE POLICY "No client access to cardsight cache"
ON public.cardsight_cache
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- user_badges: awarded only by the server-side scoring job.
REVOKE INSERT, UPDATE, DELETE ON public.user_badges FROM anon, authenticated;
REVOKE ALL ON public.user_badges FROM anon;
GRANT SELECT ON public.user_badges TO authenticated;
GRANT ALL ON public.user_badges TO service_role;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Badges cannot be created by clients" ON public.user_badges;
CREATE POLICY "Badges cannot be created by clients"
ON public.user_badges
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "Badges cannot be modified by clients" ON public.user_badges;
CREATE POLICY "Badges cannot be modified by clients"
ON public.user_badges
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "Badges cannot be deleted by clients" ON public.user_badges;
CREATE POLICY "Badges cannot be deleted by clients"
ON public.user_badges
FOR DELETE
TO anon, authenticated
USING (false);