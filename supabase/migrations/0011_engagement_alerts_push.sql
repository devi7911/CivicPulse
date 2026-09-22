-- Area watches, city alerts, phone push notifications, missions, leaderboard, petitions and admin insights.

-- ---------------------------------------------------------------------------------------------
-- Watch an area: get notified about new reports near a place you care about
-- ---------------------------------------------------------------------------------------------
create table public.watch_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 500 check (radius_m between 100 and 3000),
  created_at timestamptz not null default now()
);
create index on public.watch_areas (user_id);
create index on public.watch_areas (lat, lng);
alter table public.watch_areas enable row level security;
revoke all on public.watch_areas from anon, authenticated;
grant select, delete on public.watch_areas to authenticated;
grant insert (user_id, name, lat, lng, radius_m) on public.watch_areas to authenticated;
create policy "own watch areas" on public.watch_areas for select to authenticated using (user_id = (select auth.uid()));
create policy "add own watch area" on public.watch_areas for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    and (select count(*) from public.watch_areas w where w.user_id = (select auth.uid())) < 5);
create policy "delete own watch area" on public.watch_areas for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable set search_path = ''
as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function public.notify_watchers()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.confidential or new.lat is null then return new; end if;
  insert into public.notifications (user_id, issue_id, kind, title, body)
  select distinct w.user_id, new.id, 'area', left('New report near ' || w.name, 140), left(new.title || ' — ' || new.location_text, 300)
  from public.watch_areas w
  where w.user_id is distinct from new.author_id
    and w.lat between new.lat - 0.03 and new.lat + 0.03 and w.lng between new.lng - 0.03 and new.lng + 0.03
    and public.distance_m(w.lat, w.lng, new.lat, new.lng) <= w.radius_m;
  return new;
end;
$$;
revoke execute on function public.notify_watchers() from public, anon, authenticated;
create trigger issues_notify_watchers after insert on public.issues for each row execute function public.notify_watchers();

-- ---------------------------------------------------------------------------------------------
-- City alerts (floods, power or water cuts, traffic), published by admins
-- ---------------------------------------------------------------------------------------------
create table public.city_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('flood', 'power', 'water', 'traffic', 'health', 'other')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'danger')),
  title text not null check (char_length(title) between 5 and 120),
  body text not null check (char_length(body) between 5 and 1000),
  area text check (area is null or char_length(area) <= 120),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  radius_m integer check (radius_m is null or radius_m between 200 and 30000),
  link text check (link is null or link ~ '^https://'),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on public.city_alerts (ends_at desc);
alter table public.city_alerts enable row level security;
revoke all on public.city_alerts from anon, authenticated;
grant select on public.city_alerts to anon, authenticated;
grant insert, update, delete on public.city_alerts to authenticated;
create policy "alerts readable" on public.city_alerts for select using (true);
create policy "admins publish alerts" on public.city_alerts for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit alerts" on public.city_alerts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete alerts" on public.city_alerts for delete to authenticated using ((select public.is_admin()));
create trigger alerts_audit after insert or update or delete on public.city_alerts for each row execute function public.audit_row();

-- Alerts reach everyone with an account; located alerts also reach people watching that area.
create or replace function public.notify_alert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'alert', left(upper(new.severity) || ': ' || new.title, 140), left(coalesce(new.area || ' — ', '') || new.body, 300)
  from public.profiles p join auth.users u on u.id = p.id
  where not coalesce(u.is_anonymous, false)
    and (new.lat is null or exists (
      select 1 from public.watch_areas w where w.user_id = p.id
        and public.distance_m(w.lat, w.lng, new.lat, new.lng) <= coalesce(new.radius_m, 2000) + w.radius_m));
  return new;
end;
$$;
revoke execute on function public.notify_alert() from public, anon, authenticated;
create trigger alerts_notify after insert on public.city_alerts for each row execute function public.notify_alert();

-- ---------------------------------------------------------------------------------------------
-- Phone and browser push notifications (Web Push). Every in-app notification is also pushed to
-- the person's registered devices by the send-push edge function.
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "add own push subscription" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "remove own push subscription" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Public half of the push key pair; the private half stays in private.app_secrets.
create or replace function public.push_public_key()
returns text
language sql stable security definer set search_path = ''
as $$ select value from private.app_secrets where key = 'vapid_public'; $$;
grant execute on function public.push_public_key() to anon, authenticated;

-- Called by the edge function (service role) to drop subscriptions the push service says are gone.
create or replace function public.remove_push_endpoint(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint; $$;
revoke execute on function public.remove_push_endpoint(text) from public, anon, authenticated;
grant execute on function public.remove_push_endpoint(text) to service_role;

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  subs jsonb;
  pub text;
  priv text;
begin
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
  into subs from public.push_subscriptions where user_id = new.user_id;
  if subs is null then return new; end if;
  select value into pub from private.app_secrets where key = 'vapid_public';
  select value into priv from private.app_secrets where key = 'vapid_private';
  if pub is null or priv is null then return new; end if;
  perform net.http_post(
    url := 'https://cqjeknyjzhtmdfempdvq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'vapid', jsonb_build_object('publicKey', pub, 'privateKey', priv, 'subject', 'mailto:alerts@civicpulse.invalid'),
      'subscriptions', subs,
      'payload', jsonb_build_object('title', new.title, 'body', new.body,
        'url', case when new.issue_id is not null then '/issues/' || new.issue_id else '/' end, 'tag', new.kind)),
    timeout_milliseconds := 5000);
  return new;
end;
$$;
revoke execute on function public.push_notification() from public, anon, authenticated;
create trigger notifications_push after insert on public.notifications for each row execute function public.push_notification();

-- ---------------------------------------------------------------------------------------------
-- Missions: short civic challenges that reward points
-- ---------------------------------------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 5 and 80),
  description text not null check (char_length(description) between 10 and 400),
  category public.issue_category,
  target integer not null check (target between 1 and 50),
  reward_points integer not null default 30 check (reward_points between 5 and 100),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table public.mission_completions (
  mission_id uuid not null references public.missions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (mission_id, user_id)
);
create index on public.mission_completions (user_id);
alter table public.missions enable row level security;
alter table public.mission_completions enable row level security;
revoke all on public.missions, public.mission_completions from anon, authenticated;
grant select on public.missions to anon, authenticated;
grant insert, update, delete on public.missions to authenticated;
grant select on public.mission_completions to authenticated;
create policy "missions readable" on public.missions for select using (true);
create policy "admins add missions" on public.missions for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit missions" on public.missions for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete missions" on public.missions for delete to authenticated using ((select public.is_admin()));
create policy "own completions" on public.mission_completions for select to authenticated using (user_id = (select auth.uid()));
create trigger missions_audit after insert or update or delete on public.missions for each row execute function public.audit_row();

create or replace function public.my_missions()
returns table (id uuid, title text, description text, category public.issue_category, target integer,
  reward_points integer, ends_at timestamptz, progress integer, completed boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.title, m.description, m.category, m.target, m.reward_points, m.ends_at,
    least(m.target, (select count(*) from public.issues i where i.author_id = (select auth.uid())
      and i.created_at between m.starts_at and m.ends_at and (m.category is null or i.category = m.category)))::integer,
    exists (select 1 from public.mission_completions c where c.mission_id = m.id and c.user_id = (select auth.uid()))
  from public.missions m
  where m.ends_at > now() and m.starts_at <= now()
  order by m.ends_at;
$$;
grant execute on function public.my_missions() to anon, authenticated;

create or replace function public.check_missions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  m record;
  done integer;
begin
  if new.author_id is null or public.is_guest(new.author_id) then return new; end if;
  for m in select * from public.missions where now() between starts_at and ends_at
      and (category is null or category = new.category)
      and not exists (select 1 from public.mission_completions c where c.mission_id = missions.id and c.user_id = new.author_id) loop
    select count(*) into done from public.issues i where i.author_id = new.author_id
      and i.created_at between m.starts_at and m.ends_at and (m.category is null or i.category = m.category);
    if done >= m.target then
      insert into public.mission_completions (mission_id, user_id) values (m.id, new.author_id);
      perform public.award_points(new.author_id, m.reward_points, 'Mission completed: ' || m.title);
      insert into public.notifications (user_id, kind, title, body)
      values (new.author_id, 'mission', left('Mission complete: ' || m.title, 140), '+' || m.reward_points || ' points. Thank you!');
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.check_missions() from public, anon, authenticated;
create trigger issues_check_missions after insert on public.issues for each row execute function public.check_missions();

insert into public.missions (title, description, category, target, reward_points, ends_at) values
  ('Street light spotter', 'Report 3 broken or dark street lights in your neighbourhood this month.', 'lighting', 3, 40, date_trunc('month', now()) + interval '1 month'),
  ('Clean streets week', 'Flag 2 garbage or debris problems near you.', 'waste', 2, 30, now() + interval '14 days');

-- Top contributors this month (accounts only, no guests or banned users).
create or replace function public.leaderboard()
returns table (display_name text, verified boolean, points bigint)
language sql stable security definer set search_path = ''
as $$
  select p.display_name, p.verified, sum(l.delta)::bigint
  from public.points_ledger l
  join public.profiles p on p.id = l.user_id
  join auth.users u on u.id = p.id
  where l.delta > 0 and l.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata')
    and not p.banned and not coalesce(u.is_anonymous, false)
  group by p.id, p.display_name, p.verified
  order by 3 desc
  limit 20;
$$;
grant execute on function public.leaderboard() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Petitions: enough support obliges an official public response
-- ---------------------------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 10 and 120),
  body text not null check (char_length(body) between 30 and 3000),
  category public.issue_category not null default 'other',
  threshold integer not null default 100,
  support_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'threshold', 'responded')),
  decision text check (decision is null or decision in ('adopted', 'partial', 'rejected', 'study')),
  response text check (response is null or char_length(response) <= 3000),
  responded_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.proposals (created_at desc);
create index on public.proposals (author_id);
create table public.proposal_supports (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);
create index on public.proposal_supports (user_id);

alter table public.proposals enable row level security;
alter table public.proposal_supports enable row level security;
revoke all on public.proposals, public.proposal_supports from anon, authenticated;
grant select on public.proposals to anon, authenticated;
grant insert (author_id, title, body, category) on public.proposals to authenticated;
grant select, delete on public.proposal_supports to authenticated;
grant insert (proposal_id, user_id) on public.proposal_supports to authenticated;

create policy "proposals readable unless hidden" on public.proposals for select using (not hidden or author_id = (select auth.uid()) or (select public.is_admin()));
create policy "propose as self" on public.proposals for insert to authenticated
  with check (author_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) and not (select public.is_banned()));
create policy "own supports" on public.proposal_supports for select to authenticated using (user_id = (select auth.uid()));
create policy "support as self" on public.proposal_supports for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) and not (select public.is_banned()));
create policy "withdraw own support" on public.proposal_supports for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.proposals_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.proposals where author_id = new.author_id and created_at >= now() - interval '30 days') >= 2 then
    raise exception 'You can start 2 petitions every 30 days';
  end if;
  new.threshold := 100; new.support_count := 0; new.status := 'open'; new.decision := null;
  new.response := null; new.responded_at := null; new.hidden := false; new.created_at := now();
  return new;
end;
$$;
revoke execute on function public.proposals_before_insert() from public, anon, authenticated;
create trigger proposals_bi before insert on public.proposals for each row execute function public.proposals_before_insert();

create or replace function public.supports_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals;
begin
  if tg_op = 'INSERT' then
    update public.proposals set support_count = support_count + 1 where id = new.proposal_id returning * into p;
    if p.status = 'open' and p.support_count >= p.threshold then
      update public.proposals set status = 'threshold' where id = p.id;
      insert into public.notifications (user_id, kind, title, body)
      select id, 'petition', left('Petition needs an official response: ' || p.title, 140), p.support_count || ' people support it.'
      from public.profiles where role = 'admin';
    end if;
    return new;
  else
    update public.proposals set support_count = greatest(0, support_count - 1) where id = old.proposal_id;
    return old;
  end if;
end;
$$;
revoke execute on function public.supports_after_change() from public, anon, authenticated;
create trigger supports_aid after insert or delete on public.proposal_supports for each row execute function public.supports_after_change();

create or replace function public.respond_to_proposal(p_id uuid, p_decision text, p_response text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.proposals;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_decision not in ('adopted', 'partial', 'rejected', 'study') then raise exception 'Unknown decision'; end if;
  if char_length(trim(coalesce(p_response, ''))) < 20 then raise exception 'Write a response of at least 20 characters'; end if;
  update public.proposals set status = 'responded', decision = p_decision, response = trim(p_response), responded_at = now()
  where id = p_id returning * into p;
  insert into public.notifications (user_id, kind, title, body)
  select distinct u, 'petition', left('Official response: ' || p.title, 140), left(trim(p_response), 300)
  from (select p.author_id as u union select user_id from public.proposal_supports where proposal_id = p_id) s
  where u is not null;
  perform public.log_admin('respond', 'proposals', p_id::text, jsonb_build_object('decision', p_decision));
end;
$$;
revoke execute on function public.respond_to_proposal(uuid, text, text) from public, anon;
grant execute on function public.respond_to_proposal(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Admin insights
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_insights()
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return json_build_object(
    'weeks', (select json_agg(w order by w.week) from (
      select to_char(g.week, 'DD Mon') as label, g.week,
        (select count(*) from public.issues i where i.created_at >= g.week and i.created_at < g.week + interval '7 days') as reported,
        (select count(*) from public.issues i where i.resolved_at >= g.week and i.resolved_at < g.week + interval '7 days') as resolved
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '7 days') as g(week)) w),
    'by_category', (select json_agg(c) from (select category, count(*) as total,
        count(*) filter (where status in ('pending', 'progress')) as open from public.issues group by category order by 2 desc) c),
    'avg_days_to_fix', (select round((avg(extract(epoch from resolved_at - created_at) / 86400))::numeric, 1) from public.issues where status = 'resolved'),
    'open_flags', (select count(*) from public.content_flags where status = 'open'),
    'guest_share', (select round(100.0 * count(*) filter (where c.issue_id is not null) / greatest(count(*), 1)) from public.issues i
      left join public.issue_reporter_contacts c on c.issue_id = i.id where i.created_at >= now() - interval '30 days'),
    'users', (select count(*) from public.profiles),
    'reports_30d', (select count(*) from public.issues where created_at >= now() - interval '30 days')
  );
end;
$$;
revoke execute on function public.admin_insights() from public, anon;
grant execute on function public.admin_insights() to authenticated;
