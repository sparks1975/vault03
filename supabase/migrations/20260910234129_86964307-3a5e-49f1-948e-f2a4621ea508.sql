-- access_requests: all client writes/reads denied; server (service_role) handles submissions
REVOKE INSERT, UPDATE, DELETE ON public.access_requests FROM anon, authenticated;
REVOKE SELECT ON public.access_requests FROM anon;
GRANT ALL ON public.access_requests TO service_role;

CREATE POLICY "No client inserts on access requests"
ON public.access_requests FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "No client updates on access requests"
ON public.access_requests FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes on access requests"
ON public.access_requests FOR DELETE TO anon, authenticated USING (false);

-- api_usage_events: writes only via service role
REVOKE INSERT, UPDATE, DELETE ON public.api_usage_events FROM anon, authenticated;
REVOKE SELECT ON public.api_usage_events FROM anon;
GRANT ALL ON public.api_usage_events TO service_role;

CREATE POLICY "No client inserts on api usage"
ON public.api_usage_events FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "No client updates on api usage"
ON public.api_usage_events FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes on api usage"
ON public.api_usage_events FOR DELETE TO anon, authenticated USING (false);

-- invites: code_hash/email never readable by anon; redemption only via secure server function
REVOKE INSERT, UPDATE, DELETE ON public.invites FROM anon, authenticated;
REVOKE SELECT ON public.invites FROM anon;
GRANT ALL ON public.invites TO service_role;

CREATE POLICY "No client inserts on invites"
ON public.invites FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "No client updates on invites"
ON public.invites FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes on invites"
ON public.invites FOR DELETE TO anon, authenticated USING (false);