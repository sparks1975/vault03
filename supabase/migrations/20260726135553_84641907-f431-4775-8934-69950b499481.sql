ALTER TABLE public.card_sales ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS card_sales_card_manual_idx ON public.card_sales (card_id, is_manual);