-- Community contributions must include a photo of the work (admins exempt). Existing rows are untouched.
create or replace function public.contributions_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text;
  wk integer;
  mo integer;
begin
  new.applause_count := 0; new.hidden := false; new.created_at := now();
  if public.is_admin() then return new; end if;
  if coalesce(trim(new.photo_path), '') = '' then
    raise exception 'Please add a photo of the work.';
  end if;
  select account_type into kind from public.profiles where id = new.author_id;
  select count(*) filter (where created_at > now() - interval '7 days'), count(*)
    into wk, mo from public.contributions where author_id = new.author_id and created_at > now() - interval '30 days';
  if kind = 'individual' and (wk >= 1 or mo >= 3) then
    raise exception 'You can share 1 contribution a week (3 a month). This keeps the tab about the community, not self-promotion.';
  elsif kind <> 'individual' and (wk >= 3 or mo >= 10) then
    raise exception 'Organisations can share 3 contributions a week (10 a month).';
  end if;
  if new.kind = 'achievement' and not exists (select 1 from public.profiles where id = new.author_id and points >= 50) then
    raise exception 'Achievements can be shared after earning 50 points by reporting and helping.';
  end if;
  return new;
end;
$$;
revoke execute on function public.contributions_before_insert() from public, anon, authenticated;
