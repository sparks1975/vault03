CREATE TABLE public.api_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL DEFAULT 'thecardapi',
  endpoint text NOT NULL,
  query text,
  ok boolean NOT NULL DEFAULT true,
  status integer,
  result_count integer,
  raw_count integer,
  duration_ms integer,
  daily_limit integer,
  remaining integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX api_usage_events_created_at_idx ON public.api_usage_events (created_at DESC);

GRANT SELECT ON public.api_usage_events TO authenticated;
GRANT ALL ON public.api_usage_events TO service_role;

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read api usage" ON public.api_usage_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));