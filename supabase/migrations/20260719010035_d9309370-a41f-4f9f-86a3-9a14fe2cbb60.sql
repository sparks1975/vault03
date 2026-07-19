ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS cardsight_card_id uuid,
  ADD COLUMN IF NOT EXISTS cardsight_parallel_id uuid,
  ADD COLUMN IF NOT EXISTS cardsight_grade_id uuid;