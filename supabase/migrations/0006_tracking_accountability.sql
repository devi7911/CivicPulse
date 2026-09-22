-- Features from the civic-app research: reference numbers, promised fix dates, "closed without a fix",
-- reporter accepts or rejects the fix, anonymous and confidential reports, follows, notifications,
-- extra photos from other citizens, duplicate lookup and a public department scorecard.
-- (0005 added the 'closed' status value on its own.)

-- =====================================================================
-- Issues: new columns
-- =====================================================================
create sequence if not exists public.issue_ref_seq;

alter table public.issues
  add column ref_no text,
  add column public_author_id uuid references public.profiles (id) on delete set null,
  add column anonymous boolean not null default false,
  add column confidential boolean not null default false,
  add column target_date date,
  add column closed_reason text check (closed_reason is null or closed_reason in ('private_land', 'other_agency', 'no_budget', 'not_an_issue', 'duplicate')),
  add column closed_note text check (closed_note is null or char_length(closed_note) <= 300),
  add column resolved_at timestamptz,
  add column verdict text check (verdict is null or verdict in ('accepted', 'rejected')),
  add column verdict_at timestamptz,
  add column reopen_count integer not null default 0;

-- Backfill existing rows without firing the status-change trigger.
alter table public.issues disable trigger issues_bu;
with ordered as (select id, row_number() over (order by created_at) as n from public.issues)
update public.issues i
set ref_no = 'CP-' || to_char(i.created_at at time zone 'Asia/Kolkata', 'YY') || '-' || lpad(o.n::text, 6, '0'),
    public_author_id = i.author_id,
    resolved_at = case when i.status = 'resolved' then i.updated_at end
from ordered o where o.id = i.id;
select setval('public.issue_ref_seq', greatest((select count(*) from public.issues), 1));
alter table public.issues enable trigger issues_bu;

alter table public.issues alter column ref_no set not null;
alter table public.issues add constraint issues_ref_no_key unique (ref_no);
create index on public.issues (public_author_id);
create index on public.issues (assignee);
create index on public.issues (lat, lng);

-- =====================================================================
-- Who reported an issue is private. author_id can no longer be read through the API;
-- public_author_id is the display name source and is empty for anonymous reports.
-- Row-level security policies can still use author_id.
-- =====================================================================
revoke select on public.issues from anon, authenticated;
grant select (id, ref_no, public_author_id, title, description, category, status, photo_path,
  resolved_photo_path, lat, lng, location_text, priority_score, severity, assignee, upvote_count,
  comment_count, created_at, updated_at, anonymous, confidential, target_date, closed_reason,
  closed_note, resolved_at, verdict, verdict_at, reopen_count)
  on public.issues to anon, authenticated;
grant insert (anonymous, confidential) on public.issues to authenticated;
grant update (target_date, closed_reason, closed_note) on public.issues to authenticated;

-- Confidential reports are visible only to their reporter and to admins.
drop policy "issues readable by all" on public.issues;
create policy "issues readable unless confidential" on public.issues for select
  using (not confidential or author_id = (select auth.uid()) or (select public.is_admin()));

-- =====================================================================
-- Triggers
-- =====================================================================
create or replace function public.issues_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  txt text := lower(new.title || ' ' || new.description);
  score integer;
  kw text;
  today_count integer;
begin
  select count(*) into today_count from public.issues
  where author_id = new.author_id and created_at >= now() - interval '1 day';
  if today_count >= 10 then
    raise exception 'Daily report limit reached. Please try again tomorrow.';
  end if;

  score := case new.category
    when 'water' then 50 when 'roads' then 40 when 'waste' then 30
    when 'lighting' then 25 else 20 end;
  foreach kw in array array['danger','hazard','risk','accident','harm','collapse','injury','toxic','poison'] loop
    if position(kw in txt) > 0 then score := score + 10; end if;
  end loop;
  foreach kw in array array['urgent','emergency','immediate','leak','flood','burst','electric shock','exposed wire'] loop
    if position(kw in txt) > 0 then score := score + 8; end if;
  end loop;
  foreach kw in array array['child','kids','elderly','school','hospital','baby'] loop
    if position(kw in txt) > 0 then score := score + 5; end if;
  end loop;
  score := least(100, score);

  new.ref_no := 'CP-' || to_char(now() at time zone 'Asia/Kolkata', 'YY') || '-'
    || lpad(nextval('public.issue_ref_seq')::text, 6, '0');
  new.public_author_id := case when new.anonymous then null else new.author_id end;
  new.priority_score := score;
  new.severity := (case when score >= 70 then 'high' when score >= 40 then 'medium' else 'low' end)::public.severity;
  new.status := 'pending';
  new.assignee := null;
  new.resolved_photo_path := null;
  new.target_date := null;
  new.closed_reason := null;
  new.closed_note := null;
  new.resolved_at := null;
  new.verdict := null;
  new.verdict_at := null;
  new.reopen_count := 0;
  new.upvote_count := 0;
  new.comment_count := 0;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.issues_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  reopening boolean := coalesce(current_setting('civicpulse.reopen', true), '') = 'on';
  reason_label text;
begin
  new.updated_at := now();

  if new.status is distinct from old.status then
    if not ((old.status = 'pending' and new.status in ('progress', 'closed'))
         or (old.status = 'progress' and new.status in ('pending', 'resolved', 'closed'))
         or (old.status = 'closed' and new.status = 'pending')
         or (old.status = 'resolved' and new.status = 'progress' and reopening)) then
      raise exception 'Invalid status change from % to %', old.status, new.status;
    end if;

    if new.status = 'resolved' then
      if new.resolved_photo_path is null then
        raise exception 'A resolution photo is required to resolve an issue';
      end if;
      new.resolved_at := now();
      new.verdict := null;
      new.verdict_at := null;
    end if;

    if new.status = 'closed' then
      if new.closed_reason is null then
        raise exception 'Choose a reason when closing an issue without a fix';
      end if;
      reason_label := case new.closed_reason
        when 'private_land' then 'It is on private property.'
        when 'other_agency' then 'It is handled by another agency.'
        when 'no_budget' then 'There is no budget for it right now.'
        when 'not_an_issue' then 'On inspection this was not a problem.'
        when 'duplicate' then 'It duplicates another report.' end;
    elsif old.status = 'closed' then
      new.closed_reason := null;
      new.closed_note := null;
    end if;

    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (new.id, new.status,
      case
        when reopening then 'Reopened by the reporter'
        when new.status = 'progress' then 'Work started'
        when new.status = 'resolved' then 'Resolved'
        when new.status = 'closed' then 'Closed without a fix'
        when old.status = 'closed' then 'Reopened for review'
        else 'Moved back to pending' end,
      case
        when reopening then coalesce(current_setting('civicpulse.reopen_note', true), '')
        when new.status = 'resolved' then 'Proof photo uploaded. The reporter has 7 days to confirm the fix.'
        when new.status = 'closed' then trim(reason_label || ' ' || coalesce(new.closed_note, ''))
        else '' end,
      (select auth.uid()));

    if new.status = 'resolved' then
      perform public.award_points(old.author_id, 50, 'Your reported issue was resolved');
    end if;
  end if;

  if new.assignee is distinct from old.assignee and new.assignee is not null then
    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (new.id, new.status, 'Assigned', 'Assigned to ' || new.assignee, (select auth.uid()));
  end if;

  if new.target_date is distinct from old.target_date and new.target_date is not null then
    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (new.id, new.status, 'Fix date promised',
      'Planned completion by ' || to_char(new.target_date, 'FMDD Mon YYYY') || '.', (select auth.uid()));
  end if;

  return new;
end;
$$;

-- =====================================================================
-- Reporter accepts or rejects a fix, within 7 days of it being marked resolved
-- =====================================================================
create or replace function public.respond_to_fix(p_issue uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  it public.issues;
begin
  select * into it from public.issues where id = p_issue for update;
  if it.id is null then raise exception 'Report not found'; end if;
  if it.author_id is distinct from (select auth.uid()) then
    raise exception 'Only the person who reported this can confirm the fix';
  end if;
  if it.status <> 'resolved' then raise exception 'This report is not waiting for your confirmation'; end if;
  if it.verdict is not null then raise exception 'You have already responded to this fix'; end if;
  if it.resolved_at < now() - interval '7 days' then
    raise exception 'The 7-day window to respond has passed';
  end if;

  if p_accept then
    update public.issues set verdict = 'accepted', verdict_at = now() where id = p_issue;
    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (p_issue, 'resolved', 'Fix confirmed by the reporter', '', (select auth.uid()));
    perform public.award_points(it.author_id, 10, 'Confirmed a fix');
  else
    if coalesce(trim(p_note), '') = '' then raise exception 'Please say what is still wrong'; end if;
    perform set_config('civicpulse.reopen', 'on', true);
    perform set_config('civicpulse.reopen_note', left(trim(p_note), 300), true);
    update public.issues
    set status = 'progress', verdict = 'rejected', verdict_at = now(), reopen_count = reopen_count + 1
    where id = p_issue;
    perform set_config('civicpulse.reopen', 'off', true);
  end if;
end;
$$;
revoke execute on function public.respond_to_fix(uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_fix(uuid, boolean, text) to authenticated;

-- The reporter's own reports, including anonymous and confidential ones.
create or replace function public.my_issues()
returns setof public.issues
language sql stable security definer set search_path = ''
as $$
  select * from public.issues where author_id = (select auth.uid()) order by created_at desc limit 50;
$$;
revoke execute on function public.my_issues() from public, anon;
grant execute on function public.my_issues() to authenticated;

-- Is the signed-in user the reporter of this issue? (author_id itself is not readable.)
create or replace function public.is_my_issue(p_issue uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.issues where id = p_issue and author_id = (select auth.uid()));
$$;
revoke execute on function public.is_my_issue(uuid) from public, anon;
grant execute on function public.is_my_issue(uuid) to authenticated;

-- =====================================================================
-- Follows and notifications
-- =====================================================================
create table public.issue_follows (
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index on public.issue_follows (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  issue_id uuid references public.issues (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (issue_id);

alter table public.issue_follows enable row level security;
alter table public.notifications enable row level security;
revoke all on public.issue_follows, public.notifications from anon, authenticated;
grant select, delete on public.issue_follows to authenticated;
grant insert (issue_id, user_id) on public.issue_follows to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "read own follows" on public.issue_follows for select to authenticated
  using (user_id = (select auth.uid()));
create policy "follow as self" on public.issue_follows for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.issues i where i.id = issue_id));
create policy "unfollow own" on public.issue_follows for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Notify the reporter and everyone following an issue, except the person who caused the change.
create or replace function public.notify_issue(p_issue uuid, p_kind text, p_title text, p_body text, p_except uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, issue_id, kind, title, body)
  select distinct u.id, p_issue, p_kind, left(p_title, 140), left(p_body, 300)
  from (
    select author_id as id from public.issues where id = p_issue
    union
    select user_id from public.issue_follows where issue_id = p_issue
  ) u
  where u.id is distinct from p_except;
end;
$$;
revoke execute on function public.notify_issue(uuid, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.timeline_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  it record;
begin
  if new.title = 'Reported' then return new; end if;
  select title, ref_no into it from public.issues where id = new.issue_id;
  perform public.notify_issue(new.issue_id, 'status',
    new.title || ' · ' || it.ref_no,
    it.title || case when new.note <> '' then ' — ' || new.note else '' end,
    new.actor_id);
  return new;
end;
$$;
revoke execute on function public.timeline_after_insert() from public, anon, authenticated;
create trigger timeline_ai after insert on public.issue_timeline
  for each row execute function public.timeline_after_insert();

create or replace function public.comments_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  it record;
  who text;
begin
  select title, ref_no into it from public.issues where id = new.issue_id;
  select display_name into who from public.profiles where id = new.author_id;
  perform public.notify_issue(new.issue_id, 'comment',
    'New comment · ' || it.ref_no, coalesce(who, 'Someone') || ': ' || new.body, new.author_id);
  return new;
end;
$$;
revoke execute on function public.comments_notify() from public, anon, authenticated;
create trigger comments_notify_ai after insert on public.comments
  for each row execute function public.comments_notify();

-- =====================================================================
-- Extra photos from other citizens ("add my photo")
-- =====================================================================
create table public.issue_photos (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  created_at timestamptz not null default now()
);
create index on public.issue_photos (issue_id, created_at);
create index on public.issue_photos (user_id);

create or replace function public.issue_photos_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if split_part(new.path, '/', 1) <> new.user_id::text then raise exception 'Invalid photo path'; end if;
  if (select count(*) from public.issue_photos where issue_id = new.issue_id and user_id = new.user_id) >= 3 then
    raise exception 'You can add up to 3 photos to a report';
  end if;
  if (select status from public.issues where id = new.issue_id) in ('resolved', 'closed') then
    raise exception 'This report is already closed';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke execute on function public.issue_photos_before_insert() from public, anon, authenticated;
create trigger issue_photos_bi before insert on public.issue_photos
  for each row execute function public.issue_photos_before_insert();

alter table public.issue_photos enable row level security;
revoke all on public.issue_photos from anon, authenticated;
grant select on public.issue_photos to anon, authenticated;
grant insert (issue_id, user_id, path), delete on public.issue_photos to authenticated;
create policy "photos follow issue visibility" on public.issue_photos for select
  using (exists (select 1 from public.issues i where i.id = issue_id));
create policy "add photo as self" on public.issue_photos for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.issues i where i.id = issue_id));
create policy "delete own photo or admin" on public.issue_photos for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- =====================================================================
-- Duplicate lookup: open reports of the same kind within a short walk
-- =====================================================================
create or replace function public.nearby_open_issues(p_lat double precision, p_lng double precision,
  p_category public.issue_category, p_radius_m integer default 250)
returns table (id uuid, ref_no text, title text, status public.issue_status, upvote_count integer,
  distance_m integer, photo_path text)
language sql stable security invoker set search_path = ''
as $$
  select s.id, s.ref_no, s.title, s.status, s.upvote_count, round(s.dist)::integer, s.photo_path
  from (
    select i.id, i.ref_no, i.title, i.status, i.upvote_count, i.photo_path,
      6371000 * 2 * asin(sqrt(
        power(sin(radians(i.lat - p_lat) / 2), 2)
        + cos(radians(p_lat)) * cos(radians(i.lat)) * power(sin(radians(i.lng - p_lng) / 2), 2))) as dist
    from public.issues i
    where i.lat is not null and i.category = p_category and i.status in ('pending', 'progress')
      and i.lat between p_lat - 0.01 and p_lat + 0.01 and i.lng between p_lng - 0.01 and p_lng + 0.01
  ) s
  where s.dist <= least(greatest(p_radius_m, 50), 1000)
  order by s.dist
  limit 5;
$$;

-- =====================================================================
-- Dashboard numbers and the public department scorecard
-- =====================================================================
create or replace function public.issue_stats()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'progress', count(*) filter (where status = 'progress'),
    'resolved', count(*) filter (where status = 'resolved'),
    'closed', count(*) filter (where status = 'closed'),
    'overdue', count(*) filter (where status in ('pending', 'progress')
      and target_date < (now() at time zone 'Asia/Kolkata')::date)
  ) from public.issues;
$$;

-- Counts every report, confidential ones included; only totals are returned, never details.
create or replace function public.department_scorecard()
returns table (department text, total integer, open integer, resolved integer, closed integer,
  overdue integer, reopened integer, avg_days_to_fix numeric, on_time_pct integer, confirmed_pct integer)
language sql stable security definer set search_path = ''
as $$
  select assignee,
    count(*)::integer,
    count(*) filter (where status in ('pending', 'progress'))::integer,
    count(*) filter (where status = 'resolved')::integer,
    count(*) filter (where status = 'closed')::integer,
    count(*) filter (where status in ('pending', 'progress')
      and target_date < (now() at time zone 'Asia/Kolkata')::date)::integer,
    count(*) filter (where reopen_count > 0)::integer,
    round((avg(extract(epoch from resolved_at - created_at) / 86400)
      filter (where status = 'resolved'))::numeric, 1),
    case when count(*) filter (where status = 'resolved' and target_date is not null) = 0 then null
      else round(100.0 * count(*) filter (where status = 'resolved' and target_date is not null
        and (resolved_at at time zone 'Asia/Kolkata')::date <= target_date)
        / count(*) filter (where status = 'resolved' and target_date is not null))::integer end,
    case when count(*) filter (where status = 'resolved') = 0 then null
      else round(100.0 * count(*) filter (where status = 'resolved' and (verdict = 'accepted'
        or (verdict is null and resolved_at < now() - interval '7 days')))
        / count(*) filter (where status = 'resolved'))::integer end
  from public.issues
  where assignee is not null
  group by assignee
  order by count(*) filter (where status in ('pending', 'progress')
    and target_date < (now() at time zone 'Asia/Kolkata')::date) desc, count(*) desc;
$$;
grant execute on function public.department_scorecard() to anon, authenticated;
