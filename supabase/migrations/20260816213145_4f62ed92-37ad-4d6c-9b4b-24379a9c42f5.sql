INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE lower(email) = 'sparks@thematts.io'
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.profiles SET access_status = 'approved'
WHERE id IN (SELECT id FROM auth.users WHERE lower(email) = 'sparks@thematts.io');