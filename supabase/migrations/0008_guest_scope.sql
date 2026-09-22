-- Guests (people reporting without an account) may only report and track their own reports.
-- Backing, commenting, following, adding photos, joining events and saving emergency contacts need
-- a real account. Restrictive policies are ANDed with the existing ones.
-- Supabase marks guest sessions with the is_anonymous claim in the access token.

create policy "accounts only: back" on public.issue_upvotes as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "accounts only: comment" on public.comments as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "accounts only: follow" on public.issue_follows as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "accounts only: add photo" on public.issue_photos as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "accounts only: rsvp" on public.event_rsvps as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
create policy "accounts only: emergency contacts" on public.emergency_contacts as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));
