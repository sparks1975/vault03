-- 1. Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2. Access status on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'pending';

UPDATE public.profiles SET access_status = 'approved';

ALTER TABLE public.profiles
  ALTER COLUMN access_status SET DEFAULT 'pending';

CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Invites
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  code_preview text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read invites" ON public.invites
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_invites_updated_at BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX invites_email_idx ON public.invites (lower(email));

-- 4. Access requests
CREATE TABLE public.access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.access_requests TO authenticated;
GRANT ALL ON public.access_requests TO service_role;
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read access requests" ON public.access_requests
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_access_requests_updated_at BEFORE UPDATE ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX access_requests_email_pending_idx
  ON public.access_requests (lower(email)) WHERE status = 'pending';

-- 5. Atomic single-use redemption
CREATE OR REPLACE FUNCTION public.redeem_invite(_user_id uuid, _code_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites;
BEGIN
  SELECT * INTO v_invite FROM public.invites
  WHERE code_hash = _code_hash
    AND status IN ('pending', 'sent')
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  UPDATE public.invites
  SET status = 'used', used_by = _user_id, used_at = now()
  WHERE id = v_invite.id;

  UPDATE public.profiles SET access_status = 'approved' WHERE id = _user_id;

  UPDATE public.access_requests SET status = 'approved'
  WHERE lower(email) = lower(v_invite.email) AND status = 'pending';

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'member')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invite(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite(uuid, text) TO service_role;

-- 6. Seed admin: earliest existing account
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users ORDER BY created_at ASC LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;