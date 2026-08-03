CREATE TABLE public.contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL UNIQUE,
  week_end date NOT NULL,
  lock_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.contests TO anon;
GRANT SELECT ON public.contests TO authenticated;
GRANT ALL ON public.contests TO service_role;
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contests are publicly readable" ON public.contests FOR SELECT USING (true);
CREATE TRIGGER update_contests_updated_at BEFORE UPDATE ON public.contests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.contest_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  multiplier_total numeric NOT NULL DEFAULT 0,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);
GRANT SELECT ON public.contest_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contest_entries TO authenticated;
GRANT ALL ON public.contest_entries TO service_role;
ALTER TABLE public.contest_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Entries are publicly readable" ON public.contest_entries FOR SELECT USING (true);
CREATE POLICY "Users insert own entry while open" ON public.contest_entries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.contests c WHERE c.id = contest_id AND c.status = 'open'));
CREATE POLICY "Users update own entry while open" ON public.contest_entries FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.contests c WHERE c.id = contest_id AND c.status = 'open'))
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own entry while open" ON public.contest_entries FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.contests c WHERE c.id = contest_id AND c.status = 'open'));
CREATE TRIGGER update_contest_entries_updated_at BEFORE UPDATE ON public.contest_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.contest_entry_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.contest_entries(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mlb_player_id integer,
  player_points numeric NOT NULL DEFAULT 0,
  multiplier numeric NOT NULL DEFAULT 1,
  points numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, card_id)
);
GRANT SELECT ON public.contest_entry_cards TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contest_entry_cards TO authenticated;
GRANT ALL ON public.contest_entry_cards TO service_role;
ALTER TABLE public.contest_entry_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Entry cards are publicly readable" ON public.contest_entry_cards FOR SELECT USING (true);
CREATE POLICY "Users manage own entry cards" ON public.contest_entry_cards FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.user_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_type text NOT NULL,
  contest_id uuid REFERENCES public.contests(id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_type, contest_id)
);
GRANT SELECT ON public.user_badges TO anon;
GRANT SELECT ON public.user_badges TO authenticated;
GRANT ALL ON public.user_badges TO service_role;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Badges are publicly readable" ON public.user_badges FOR SELECT USING (true);

CREATE INDEX idx_contest_entries_contest_score ON public.contest_entries (contest_id, score DESC);
CREATE INDEX idx_contest_entry_cards_entry ON public.contest_entry_cards (entry_id);
CREATE INDEX idx_user_badges_user ON public.user_badges (user_id);