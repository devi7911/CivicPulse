-- The guest photo rule read issues.author_id, which signed-in users are not allowed to select
-- (reporter privacy, 0006). Postgres checks column rights for the whole policy, so every
-- "Add my photo" failed with "permission denied for table issues". Use is_my_issue() instead.
drop policy "accounts only: add photo" on public.issue_photos;
create policy "accounts only: add photo" on public.issue_photos as restrictive for insert to authenticated
  with check (not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) or public.is_my_issue(issue_id));
