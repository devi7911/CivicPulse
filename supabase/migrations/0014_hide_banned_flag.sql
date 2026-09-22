-- Whether someone is blocked is moderation data, not public profile data. Admins see it through
-- admin_list_users(); policies use is_banned(), which is security definer and unaffected.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_path, role, verified, points, created_at) on public.profiles to anon, authenticated;
