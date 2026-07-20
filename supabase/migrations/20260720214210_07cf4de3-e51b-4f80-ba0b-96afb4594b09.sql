
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_share_slug_idx ON public.profiles (share_slug) WHERE share_slug IS NOT NULL;
