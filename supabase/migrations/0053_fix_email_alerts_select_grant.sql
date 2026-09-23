-- 0047 granted UPDATE on profiles.email_alerts but never SELECT, so the profile page's own read of
-- its current value (to show the toggle's state) has been failing with 403 on every load since.
grant select (email_alerts) on public.profiles to authenticated;
