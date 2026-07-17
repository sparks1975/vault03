ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS is_autograph boolean NOT NULL DEFAULT false;