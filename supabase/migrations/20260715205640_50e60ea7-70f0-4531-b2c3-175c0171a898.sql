
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  team text,
  position text,
  year integer,
  set_name text,
  card_number text,
  grade text,
  grader text,
  purchase_price numeric(12,2),
  current_value numeric(12,2),
  value_delta_pct numeric(6,2),
  notes text,
  photo_url text,
  mlb_player_id integer,
  last_valued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_user_idx ON public.cards(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT ALL ON public.cards TO service_role;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own cards" ON public.cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.card_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sold_at date NOT NULL,
  grade text,
  price numeric(12,2) NOT NULL,
  source text,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_sales_card_idx ON public.card_sales(card_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_sales TO authenticated;
GRANT ALL ON public.card_sales TO service_role;
ALTER TABLE public.card_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own card sales" ON public.card_sales FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.card_value_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  value numeric(12,2) NOT NULL
);
CREATE INDEX card_value_history_card_idx ON public.card_value_history(card_id, recorded_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_value_history TO authenticated;
GRANT ALL ON public.card_value_history TO service_role;
ALTER TABLE public.card_value_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own value history" ON public.card_value_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "Users read own card photos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users upload own card photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own card photos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
