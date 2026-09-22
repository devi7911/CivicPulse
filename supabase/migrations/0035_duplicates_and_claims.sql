-- 1. Stop duplicate reports.  2. Let admins merge duplicates.  3. One admin works a ticket at a time.

------------------------------------------------------------------------------------------------
-- 1. Duplicate protection on new reports
------------------------------------------------------------------------------------------------
alter table public.issues
  add column if not exists duplicate_of uuid references public.issues (id) on delete set null,
  add column if not exists confirmed_distinct boolean not null default false;  -- set by the reporter, see below

create index if not exists issues_open_geo_idx on public.issues (category, lat, lng) where status in ('pending', 'progress');

-- Open report of the same kind within p_radius metres, nearest first.
create or replace function private.nearest_open_issue(p_lat double precision, p_lng double precision, p_category public.issue_category, p_radius integer)
returns table (id uuid, ref_no text, author_id uuid, dist double precision)
language sql stable set search_path = '' as $$
  select s.id, s.ref_no, s.author_id, s.dist from (
    select i.id, i.ref_no, i.author_id,
      6371000 * 2 * asin(sqrt(power(sin(radians(i.lat - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(i.lat)) * power(sin(radians(i.lng - p_lng) / 2), 2))) as dist
    from public.issues i
    where i.lat is not null and i.category = p_category and i.status in ('pending', 'progress') and not i.hidden
      and i.lat between p_lat - 0.005 and p_lat + 0.005 and i.lng between p_lng - 0.005 and p_lng + 0.005
  ) s where s.dist <= p_radius order by s.dist limit 1;
$$;

create or replace function public.issues_dedupe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n_id uuid; n_ref text; n_author uuid;
  same_person boolean := false;
  v_phone text := regexp_replace(coalesce(new.guest_phone, ''), '[^0-9]', '', 'g');
  v_email text := lower(trim(coalesce(new.guest_email, '')));
begin
  if new.lat is not null then
    select id, ref_no, author_id into n_id, n_ref, n_author from private.nearest_open_issue(new.lat, new.lng, new.category, 50);
  end if;

  -- Guests get a new user id each session, so match them by the hashed phone or email they gave.
  if n_id is not null then
    same_person := n_author = new.author_id;
    if not same_person and public.is_guest(new.author_id) and (v_phone <> '' or v_email <> '') then
      if v_phone ~ '^91[6-9][0-9]{9}$' then v_phone := substr(v_phone, 3); end if;
      same_person := exists (select 1 from public.issue_reporter_contacts c where c.issue_id = n_id
        and (c.phone_hash = private.hash_signal('phone:+91' || v_phone) or c.email_hash = private.hash_signal('email:' || v_email)));
    end if;
  end if;

  -- The same person reporting the same thing again: always refused.
  if same_person then
    raise exception 'DUPLICATE_OWN:%:%', n_ref, n_id
      using hint = 'You have already reported this problem here. Your existing report is being tracked.';
  end if;
  -- Without a map pin, catch the same person re-sending an identical title within a week.
  if n_id is null then
    select i.id, i.ref_no into n_id, n_ref from public.issues i
    where i.author_id = new.author_id and i.category = new.category and i.status in ('pending', 'progress')
      and lower(trim(i.title)) = lower(trim(new.title)) and i.created_at > now() - interval '7 days' limit 1;
    if n_id is not null then
      raise exception 'DUPLICATE_OWN:%:%', n_ref, n_id using hint = 'You have already reported this problem.';
    end if;
  -- Someone else already reported it here: they must confirm theirs is a different problem.
  elsif not new.confirmed_distinct then
    raise exception 'DUPLICATE:%:%', n_ref, n_id
      using hint = 'This looks like a problem that has already been reported. Back that report, or confirm yours is different.';
  end if;

  new.confirmed_distinct := false;
  return new;
end;
$$;

drop trigger if exists issues_0_dedupe on public.issues;
create trigger issues_0_dedupe before insert on public.issues for each row execute function public.issues_dedupe();

------------------------------------------------------------------------------------------------
-- 3. Ticket claims (admin-only table, so admin ids are never exposed on public reports)
------------------------------------------------------------------------------------------------
create table if not exists public.issue_claims (
  issue_id uuid primary key references public.issues (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.issue_claims enable row level security;
drop policy if exists "admins read claims" on public.issue_claims;
create policy "admins read claims" on public.issue_claims for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.issue_claims from anon, authenticated;

-- A claim lapses after 4 hours without activity, so a ticket is never stuck with someone who left.
create or replace function private.active_claim(p_issue uuid) returns public.issue_claims
language sql stable set search_path = '' as $$
  select * from public.issue_claims where issue_id = p_issue and claimed_at > now() - interval '4 hours';
$$;

create or replace function public.claim_issue(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  c public.issue_claims;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  -- Lock the row so two admins clicking at the same moment cannot both win.
  perform 1 from public.issues where id = p_id for update;
  if not found then raise exception 'That report no longer exists.'; end if;
  c := private.active_claim(p_id);
  if c.admin_id is not null and c.admin_id <> me then
    return jsonb_build_object('ok', false, 'by', (select display_name from public.profiles where id = c.admin_id), 'since', c.claimed_at);
  end if;
  insert into public.issue_claims (issue_id, admin_id, claimed_at) values (p_id, me, now())
  on conflict (issue_id) do update set admin_id = excluded.admin_id, claimed_at = excluded.claimed_at;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.release_issue(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.issue_claims where issue_id = p_id and admin_id = (select auth.uid());
end;
$$;

-- Admin edits to a ticket someone else is working on are refused. Editing an unclaimed
-- ticket claims it; each edit keeps your claim fresh. Citizens (verdicts, edits) are unaffected.
create or replace function public.issues_claim_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  c public.issue_claims;
begin
  if me is null or not public.is_admin() or pg_trigger_depth() > 1 then return new; end if;
  c := private.active_claim(new.id);
  if c.admin_id is not null and c.admin_id <> me then
    raise exception '% is working on this report. Ask them, or wait until they release it.',
      coalesce((select display_name from public.profiles where id = c.admin_id), 'Another admin');
  end if;
  if new.status in ('resolved', 'closed') then
    delete from public.issue_claims where issue_id = new.id;
  else
    insert into public.issue_claims (issue_id, admin_id, claimed_at) values (new.id, me, now())
    on conflict (issue_id) do update set admin_id = excluded.admin_id, claimed_at = excluded.claimed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists issues_0_claim_guard on public.issues;
create trigger issues_0_claim_guard before update on public.issues for each row execute function public.issues_claim_guard();

------------------------------------------------------------------------------------------------
-- 2. Merge a duplicate into the original
------------------------------------------------------------------------------------------------
create or replace function public.merge_duplicate(p_duplicate uuid, p_original_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dup public.issues;
  orig public.issues;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into dup from public.issues where id = p_duplicate;
  select * into orig from public.issues where ref_no = upper(trim(p_original_ref));
  if dup.id is null then raise exception 'That report no longer exists.'; end if;
  if orig.id is null then raise exception 'No report has the reference %.', upper(trim(p_original_ref)); end if;
  if orig.id = dup.id then raise exception 'A report cannot duplicate itself.'; end if;
  if orig.duplicate_of is not null then raise exception '% is itself a duplicate. Use the original report.', orig.ref_no; end if;
  if dup.status not in ('pending', 'progress') then raise exception 'Only open reports can be merged.'; end if;

  -- Backers and followers move to the original so nobody loses updates.
  insert into public.issue_upvotes (issue_id, user_id)
    select orig.id, u.user_id from public.issue_upvotes u where u.issue_id = dup.id and u.user_id <> orig.author_id
    on conflict do nothing;
  insert into public.issue_follows (issue_id, user_id)
    select orig.id, f.user_id from public.issue_follows f where f.issue_id = dup.id on conflict do nothing;
  insert into public.issue_follows (issue_id, user_id) values (orig.id, dup.author_id) on conflict do nothing;

  update public.issues set status = 'closed', closed_reason = 'duplicate', duplicate_of = orig.id,
    closed_note = 'Merged into ' || orig.ref_no || '. Follow that report for updates.'
  where id = dup.id;

  insert into public.notifications (user_id, issue_id, kind, title, body)
  values (dup.author_id, orig.id, 'status', 'Your report was merged',
    'Your report ' || dup.ref_no || ' is the same problem as ' || orig.ref_no || '. You now follow ' || orig.ref_no || ' and will get its updates.');

  perform public.log_admin('merge', 'issue', dup.id::text, jsonb_build_object('title', dup.ref_no || ' into ' || orig.ref_no));
end;
$$;

revoke all on function public.claim_issue(uuid), public.release_issue(uuid), public.merge_duplicate(uuid, text) from public, anon;
grant execute on function public.claim_issue(uuid), public.release_issue(uuid), public.merge_duplicate(uuid, text) to authenticated;
revoke all on function private.nearest_open_issue(double precision, double precision, public.issue_category, integer), private.active_claim(uuid) from public, anon, authenticated;

-- Reporters may set the "mine is different" flag; everyone may see which report a duplicate was merged into.
grant insert (confirmed_distinct) on public.issues to authenticated;
grant select (duplicate_of) on public.issues to anon, authenticated;
