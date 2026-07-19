CREATE TABLE public.pt130_comps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  sold_at date,
  price numeric NOT NULL,
  title text,
  url text,
  listing_type text,
  scraped_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pt130_comps_card_id_sold_at_idx ON public.pt130_comps (card_id, sold_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pt130_comps TO authenticated;
GRANT ALL ON public.pt130_comps TO service_role;

ALTER TABLE public.pt130_comps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own 130point comps"
  ON public.pt130_comps
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
