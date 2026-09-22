-- In-app "Help & feedback": a citizen opens a request, staff reply from the admin console, and the
-- thread lives in the app instead of email. All writes go through the functions below, so the
-- tables themselves grant no direct insert/update to end users.

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_author_idx on public.support_requests (author_id, created_at desc);
create index support_requests_status_idx on public.support_requests (status, created_at);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  is_staff boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index support_messages_request_idx on public.support_messages (request_id, created_at);

alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;

create policy "read own support requests or admin" on public.support_requests
  for select to authenticated using (author_id = (select auth.uid()) or public.is_admin());
create policy "read own support messages or admin" on public.support_messages
  for select to authenticated using (
    public.is_admin() or exists (select 1 from public.support_requests r where r.id = request_id and r.author_id = (select auth.uid()))
  );
-- No insert/update policies: every write goes through a function below, so limits and
-- notifications can never be bypassed by writing to the table directly.
revoke insert, update, delete on public.support_requests, public.support_messages from authenticated;

create or replace function public.open_support_request(p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  open_count integer;
  rid uuid;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if public.is_banned() then raise exception 'Your account cannot open support requests.'; end if;
  if char_length(trim(coalesce(p_subject, ''))) < 3 then raise exception 'Please add a short subject.'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 5 then raise exception 'Please describe what you need help with.'; end if;

  select count(*) into open_count from public.support_requests where author_id = me and status <> 'closed';
  if open_count >= 5 then
    raise exception 'You already have 5 open requests. Please wait for a reply, or close one first.';
  end if;

  insert into public.support_requests (author_id, subject) values (me, left(trim(p_subject), 120)) returning id into rid;
  insert into public.support_messages (request_id, author_id, is_staff, body) values (rid, me, false, left(trim(p_body), 2000));
  return rid;
end;
$$;

create or replace function public.reply_support_request(p_request uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  r public.support_requests;
  staff boolean := public.is_admin();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  select * into r from public.support_requests where id = p_request;
  if r.id is null then raise exception 'That request no longer exists.'; end if;
  if not staff and r.author_id <> me then raise exception 'That is not your request.'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 1 then raise exception 'Write a message first.'; end if;
  if r.status = 'closed' and not staff then raise exception 'This request is closed. Open a new one if you still need help.'; end if;

  insert into public.support_messages (request_id, author_id, is_staff, body) values (p_request, me, staff, left(trim(p_body), 2000));
  update public.support_requests set status = case when staff then 'answered' else 'open' end, updated_at = now() where id = p_request;

  if staff then
    insert into public.notifications (user_id, kind, title, body) values (r.author_id, 'support', 'Reply to "' || r.subject || '"', left(p_body, 200));
  end if;
end;
$$;

create or replace function public.set_support_status(p_request uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('open', 'answered', 'closed') then raise exception 'Not a valid status.'; end if;
  update public.support_requests set status = p_status, updated_at = now() where id = p_request;
  perform public.log_admin('set_status', 'support_requests', p_request::text, jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.open_support_request(text, text), public.reply_support_request(uuid, text), public.set_support_status(uuid, text) from public, anon;
grant execute on function public.open_support_request(text, text), public.reply_support_request(uuid, text) to authenticated;
grant execute on function public.set_support_status(uuid, text) to authenticated;

-- One more queue on the admin dashboard/tab badges: support requests waiting on a staff reply.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'verify',       (select count(*) from public.verification_requests where status = 'pending'),
    'flags',        (select count(*) from public.content_flags where status = 'open'),
    'ads',          (select count(*) from public.ad_campaigns where status = 'pending'),
    'sightings',    (select count(*) from public.child_alert_sightings where created_at > now() - interval '48 hours'),
    'child_expiring', (select count(*) from public.child_alerts where status = 'active' and expires_at < now() + interval '48 hours'),
    'petitions',    (select count(*) from public.proposals where status = 'threshold' and not hidden),
    'support_open', (select count(*) from public.support_requests where status = 'open'),
    'overdue',      (select count(*) from public.issues where status in ('pending', 'progress') and target_date < today and not hidden),
    'due_soon',     (select count(*) from public.issues where status in ('pending', 'progress') and target_date between today and today + 2 and not hidden),
    'reopened',     (select count(*) from public.issues where status in ('pending', 'progress') and reopen_count > 0 and not hidden),
    'claimed_now',  (select count(*) from public.issue_claims c join public.issues i on i.id = c.issue_id where c.claimed_at > now() - interval '4 hours' and i.status in ('pending', 'progress')),
    'pending_count', (select count(*) from public.issues where status = 'pending' and not hidden),
    'progress_count', (select count(*) from public.issues where status = 'progress' and not hidden),
    'oldest_open_days', (select coalesce(max(((now() at time zone 'Asia/Kolkata')::date - (created_at at time zone 'Asia/Kolkata')::date)), 0) from public.issues where status in ('pending', 'progress') and not hidden),
    'unassigned',   (select count(*) from public.issues where status in ('pending', 'progress') and assignee is null and not hidden),
    'unpaid_ads',   (select count(*) from public.ad_campaigns where status = 'approved' and not paid and ends_at > now()),
    'routes_without_stops', (select count(*) from public.bus_routes r where r.active and not exists (select 1 from public.bus_route_stops s where s.route_id = r.id)),
    'open_issues',  (select count(*) from public.issues where status in ('pending', 'progress') and not hidden),
    'reports_24h',  (select count(*) from public.issues where created_at > now() - interval '24 hours'),
    'resolved_7d',  (select count(*) from public.issues where resolved_at > now() - interval '7 days'),
    'signups_7d',   (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.created_at > now() - interval '7 days' and not coalesce(u.is_anonymous, false)),
    'errors_24h',   (select count(*) from public.client_errors where created_at > now() - interval '24 hours'),
    'activity', coalesce((
      select jsonb_agg(a order by a.created_at desc) from (
        select au.action, au.target_type, au.details ->> 'title' as title, au.created_at, p.display_name as actor
        from public.admin_audit au left join public.profiles p on p.id = au.actor_id
        order by au.created_at desc limit 8
      ) a), '[]'::jsonb)
  );
end;
$$;
