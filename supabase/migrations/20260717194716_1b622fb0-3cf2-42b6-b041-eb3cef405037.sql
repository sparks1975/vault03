ALTER TABLE public.cards ADD COLUMN is_first_bowman boolean NOT NULL DEFAULT false;

GRANT UPDATE (is_first_bowman) ON public.cards TO authenticated;
GRANT ALL ON public.cards TO service_role;