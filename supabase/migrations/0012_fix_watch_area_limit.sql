-- The 5-area limit inside the insert policy queried watch_areas itself, which Postgres rejects as
-- infinite policy recursion. Enforce the limit in a trigger instead.
drop policy "add own watch area" on public.watch_areas;
create policy "add own watch area" on public.watch_areas for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false));

create or replace function public.watch_areas_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('watch_areas:' || new.user_id::text));
  if (select count(*) from public.watch_areas where user_id = new.user_id) >= 5 then
    raise exception 'You can watch up to 5 areas';
  end if;
  return new;
end;
$$;
revoke execute on function public.watch_areas_limit() from public, anon, authenticated;
create trigger watch_areas_bi before insert on public.watch_areas for each row execute function public.watch_areas_limit();
