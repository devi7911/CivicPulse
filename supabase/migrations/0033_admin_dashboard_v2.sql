-- Admin command centre, version 2: filters (area, category, custom dates) and the full metric set.
drop function if exists public.admin_dashboard(integer);

create or replace function public.admin_dashboard(
  p_days integer default 30, p_area text default null, p_category text default null, p_from date default null, p_to date default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  d_to date := coalesce(p_to, today);
  d_from date := coalesce(p_from, d_to - (least(greatest(coalesce(p_days, 30), 1), 365) - 1));
  n integer;
  t0 timestamptz; t1 timestamptz; tp timestamptz;
  k jsonb; out jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if d_from > d_to then raise exception 'The start date must be before the end date.'; end if;
  n := least(d_to - d_from + 1, 366);
  d_from := d_to - (n - 1);
  t0 := (d_from::timestamp at time zone 'Asia/Kolkata');
  t1 := ((d_to + 1)::timestamp at time zone 'Asia/Kolkata');
  tp := t0 - (t1 - t0);

  -- Every issue metric below reads this filtered set.
  drop table if exists pg_temp.dash_i;
  create temp table dash_i on commit drop as
    select * from public.issues i
    where not i.hidden
      and (p_area is null or i.area = p_area)
      and (p_category is null or i.category::text = p_category);

  k := jsonb_build_object(
    'reports',  jsonb_build_array((select count(*) from dash_i where created_at >= t0 and created_at < t1), (select count(*) from dash_i where created_at >= tp and created_at < t0)),
    'resolved', jsonb_build_array((select count(*) from dash_i where resolved_at >= t0 and resolved_at < t1), (select count(*) from dash_i where resolved_at >= tp and resolved_at < t0)),
    'signups',  jsonb_build_array(
                  (select count(*) from auth.users where created_at >= t0 and created_at < t1 and not coalesce(is_anonymous, false)),
                  (select count(*) from auth.users where created_at >= tp and created_at < t0 and not coalesce(is_anonymous, false))),
    'days_to_fix', jsonb_build_array(
                  (select round(avg(extract(epoch from resolved_at - created_at) / 86400)::numeric, 1) from dash_i where resolved_at >= t0 and resolved_at < t1),
                  (select round(avg(extract(epoch from resolved_at - created_at) / 86400)::numeric, 1) from dash_i where resolved_at >= tp and resolved_at < t0)),
    'on_time', jsonb_build_array(
                  (select round(100.0 * count(*) filter (where target_date is null or (resolved_at at time zone 'Asia/Kolkata')::date <= target_date) / nullif(count(*), 0)) from dash_i where resolved_at >= t0 and resolved_at < t1),
                  (select round(100.0 * count(*) filter (where target_date is null or (resolved_at at time zone 'Asia/Kolkata')::date <= target_date) / nullif(count(*), 0)) from dash_i where resolved_at >= tp and resolved_at < t0)),
    -- Share of fixes the reporter accepted, out of those they answered.
    'satisfaction', jsonb_build_array(
                  (select round(100.0 * count(*) filter (where verdict = 'accepted') / nullif(count(*) filter (where verdict is not null), 0)) from dash_i where verdict_at >= t0 and verdict_at < t1),
                  (select round(100.0 * count(*) filter (where verdict = 'accepted') / nullif(count(*) filter (where verdict is not null), 0)) from dash_i where verdict_at >= tp and verdict_at < t0)),
    -- Median hours from report to the first move out of "pending".
    'first_response_h', jsonb_build_array(
                  (select round((percentile_cont(0.5) within group (order by h))::numeric, 1) from (
                     select extract(epoch from min(t.created_at) - i.created_at) / 3600 h from dash_i i join public.issue_timeline t on t.issue_id = i.id and t.status <> 'pending'
                     where i.created_at >= t0 and i.created_at < t1 group by i.id, i.created_at) s),
                  (select round((percentile_cont(0.5) within group (order by h))::numeric, 1) from (
                     select extract(epoch from min(t.created_at) - i.created_at) / 3600 h from dash_i i join public.issue_timeline t on t.issue_id = i.id and t.status <> 'pending'
                     where i.created_at >= tp and i.created_at < t0 group by i.id, i.created_at) s)),
    'active_people', jsonb_build_array(
                  (select count(distinct u) from (
                     select author_id u from public.issues where created_at >= t0 and created_at < t1 union all
                     select author_id from public.comments where created_at >= t0 and created_at < t1 union all
                     select user_id from public.issue_upvotes where created_at >= t0 and created_at < t1 union all
                     select user_id from public.event_rsvps where created_at >= t0 and created_at < t1) s),
                  (select count(distinct u) from (
                     select author_id u from public.issues where created_at >= tp and created_at < t0 union all
                     select author_id from public.comments where created_at >= tp and created_at < t0 union all
                     select user_id from public.issue_upvotes where created_at >= tp and created_at < t0 union all
                     select user_id from public.event_rsvps where created_at >= tp and created_at < t0) s)),
    -- People who reported in this period and had also reported before it.
    'returning_pct', jsonb_build_array(
                  (select round(100.0 * count(*) filter (where exists (select 1 from public.issues p where p.author_id = s.author_id and p.created_at < t0)) / nullif(count(*), 0))
                     from (select distinct author_id from public.issues where created_at >= t0 and created_at < t1) s),
                  (select round(100.0 * count(*) filter (where exists (select 1 from public.issues p where p.author_id = s.author_id and p.created_at < tp)) / nullif(count(*), 0))
                     from (select distinct author_id from public.issues where created_at >= tp and created_at < t0) s))
  );

  out := jsonb_build_object(
    'from', d_from, 'to', d_to, 'days', n, 'kpis', k,
    'filters', jsonb_build_object('area', p_area, 'category', p_category),
    'areas', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb) from (select distinct area a from public.issues where area is not null and not hidden) s),

    'daily', (select jsonb_agg(jsonb_build_object(
        'day', g.day,
        'reported', (select count(*) from dash_i i where (i.created_at at time zone 'Asia/Kolkata')::date = g.day),
        'resolved', (select count(*) from dash_i i where (i.resolved_at at time zone 'Asia/Kolkata')::date = g.day),
        'signups',  (select count(*) from auth.users u where (u.created_at at time zone 'Asia/Kolkata')::date = g.day and not coalesce(u.is_anonymous, false)),
        -- Open at the end of that day (closed reports count as done from their last update).
        'backlog',  (select count(*) from dash_i i where (i.created_at at time zone 'Asia/Kolkata')::date <= g.day
                       and not (i.resolved_at is not null and (i.resolved_at at time zone 'Asia/Kolkata')::date <= g.day)
                       and not (i.status = 'closed' and (i.updated_at at time zone 'Asia/Kolkata')::date <= g.day))
      ) order by g.day)
      from (select generate_series(d_from, d_to, interval '1 day')::date as day) g),

    -- Reports by weekday (0 = Sunday) and hour, IST.
    'heat', (select coalesce(jsonb_agg(jsonb_build_array(dow, hr, c)), '[]'::jsonb) from (
        select extract(dow from created_at at time zone 'Asia/Kolkata')::int dow, extract(hour from created_at at time zone 'Asia/Kolkata')::int hr, count(*) c
        from dash_i where created_at >= t0 and created_at < t1 group by 1, 2) s),

    'status', (select jsonb_object_agg(status, c) from (select status, count(*) c from dash_i group by status) s),
    'severity_open', (select jsonb_object_agg(severity, c) from (select severity, count(*) c from dash_i where status in ('pending', 'progress') group by severity) s),
    'category_open', (select jsonb_object_agg(category, c) from (select category, count(*) c from dash_i where status in ('pending', 'progress') group by category) s),
    'verdicts', jsonb_build_object(
        'accepted', (select count(*) from dash_i where verdict = 'accepted' and verdict_at >= t0 and verdict_at < t1),
        'rejected', (select count(*) from dash_i where verdict = 'rejected' and verdict_at >= t0 and verdict_at < t1),
        'waiting',  (select count(*) from dash_i where status = 'resolved' and verdict is null)),

    'map', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ref_no', ref_no, 'title', title, 'status', status, 'lat', lat, 'lng', lng, 'category', category,
                       'upvote_count', upvote_count, 'target_date', target_date, 'severity', severity, 'location_text', location_text, 'area', area))
            from dash_i where status in ('pending', 'progress') and lat is not null), '[]'::jsonb),

    'departments', coalesce((select jsonb_agg(x order by x.open desc, x.department) from (
        select assignee as department,
          count(*) filter (where status in ('pending', 'progress')) as open,
          count(*) filter (where status in ('pending', 'progress') and target_date < today) as overdue,
          count(*) filter (where resolved_at >= t0 and resolved_at < t1) as resolved,
          count(*) filter (where resolved_at >= tp and resolved_at < t0) as resolved_prev,
          round(avg(extract(epoch from resolved_at - created_at) / 86400) filter (where resolved_at >= t0 and resolved_at < t1)::numeric, 1) as avg_days,
          round(100.0 * count(*) filter (where resolved_at >= t0 and resolved_at < t1 and (target_date is null or (resolved_at at time zone 'Asia/Kolkata')::date <= target_date))
                / nullif(count(*) filter (where resolved_at >= t0 and resolved_at < t1), 0)) as on_time,
          round(100.0 * count(*) filter (where resolved_at >= tp and resolved_at < t0 and (target_date is null or (resolved_at at time zone 'Asia/Kolkata')::date <= target_date))
                / nullif(count(*) filter (where resolved_at >= tp and resolved_at < t0), 0)) as on_time_prev,
          count(*) filter (where verdict = 'rejected') as rejected
        from dash_i where assignee is not null group by assignee) x), '[]'::jsonb),

    'top_open', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, upvote_count, area, severity, assignee, (today - (created_at at time zone 'Asia/Kolkata')::date) as age_days
        from dash_i where status in ('pending', 'progress') order by priority_score desc, upvote_count desc limit 6) x), '[]'::jsonb),
    'stale_unassigned', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, area, (today - (created_at at time zone 'Asia/Kolkata')::date) as age_days
        from dash_i where status in ('pending', 'progress') and assignee is null order by created_at limit 6) x), '[]'::jsonb),
    'due_soon', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, assignee, target_date from dash_i
        where status in ('pending', 'progress') and target_date between today and today + 2 order by target_date limit 8) x), '[]'::jsonb),
    'reopened', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, assignee, reopen_count from dash_i
        where status in ('pending', 'progress') and reopen_count > 0 order by reopen_count desc, updated_at desc limit 6) x), '[]'::jsonb),
    'most_backed_week', coalesce((select jsonb_agg(x) from (
        select i.id, i.ref_no, i.title, count(*) as new_upvotes from public.issue_upvotes u join dash_i i on i.id = u.issue_id
        where u.created_at > now() - interval '7 days' group by i.id, i.ref_no, i.title order by count(*) desc limit 5) x), '[]'::jsonb),

    'child_alerts', coalesce((select jsonb_agg(x) from (
        select a.id, a.first_name, a.age, a.last_seen_place, a.expires_at, (select count(*) from public.child_alert_sightings s where s.alert_id = a.id) as sightings
        from public.child_alerts a where a.status = 'active' order by a.expires_at) x), '[]'::jsonb),
    'city_alerts', coalesce((select jsonb_agg(x) from (
        select id, kind, severity, title, area, ends_at from public.city_alerts
        where starts_at <= now() and (ends_at is null or ends_at > now()) order by ends_at nulls last) x), '[]'::jsonb),

    'engagement', jsonb_build_object(
        'comments', (select count(*) from public.comments where created_at >= t0 and created_at < t1),
        'upvotes', (select count(*) from public.issue_upvotes where created_at >= t0 and created_at < t1),
        'rsvps', (select count(*) from public.event_rsvps where created_at >= t0 and created_at < t1),
        'contributions', (select count(*) from public.contributions where created_at >= t0 and created_at < t1),
        'events_upcoming', (select count(*) from public.events where starts_at > now())),
    'top_contributors', coalesce((select jsonb_agg(x) from (
        select p.id, p.display_name, p.account_type, p.org_name, p.verified, sum(l.delta) as points
        from public.points_ledger l join public.profiles p on p.id = l.user_id
        where l.created_at >= t0 and l.created_at < t1 and not p.banned
        group by p.id order by sum(l.delta) desc limit 6) x), '[]'::jsonb),
    'petitions_near', coalesce((select jsonb_agg(x) from (
        select id, title, support_count, threshold from public.proposals
        where status = 'open' and not hidden and threshold > 0 and support_count >= 0.6 * threshold
        order by support_count::numeric / threshold desc limit 5) x), '[]'::jsonb),
    'events_watch', coalesce((select jsonb_agg(x) from (
        select id, title, starts_at, capacity, rsvp_count + children_count as going from public.events
        where starts_at > now() and starts_at < now() + interval '14 days'
          and (capacity is not null and (rsvp_count + children_count) >= 0.8 * capacity
               or starts_at < now() + interval '3 days' and (rsvp_count + children_count) < 3)
        order by starts_at limit 6) x), '[]'::jsonb),

    'people', jsonb_build_object(
        'total', (select count(*) from public.profiles p join auth.users u on u.id = p.id where not coalesce(u.is_anonymous, false)),
        'verified', (select count(*) from public.profiles where verified),
        'banned', (select count(*) from public.profiles where banned),
        'by_type', (select jsonb_object_agg(account_type, c) from (
            select p.account_type, count(*) c from public.profiles p join auth.users u on u.id = p.id
            where not coalesce(u.is_anonymous, false) group by p.account_type) s),
        'guest_report_pct', (select round(100.0 * count(*) filter (where public.is_guest(author_id)) / nullif(count(*), 0)) from dash_i where created_at >= t0 and created_at < t1)),
    'verification', jsonb_build_object(
        'requested', (select count(*) from public.verification_requests where created_at >= t0 and created_at < t1),
        'approved', (select count(*) from public.verification_requests where status = 'approved' and reviewed_at >= t0 and reviewed_at < t1),
        'rejected', (select count(*) from public.verification_requests where status = 'rejected' and reviewed_at >= t0 and reviewed_at < t1),
        'pending', (select count(*) from public.verification_requests where status = 'pending'),
        'avg_review_h', (select round(avg(extract(epoch from reviewed_at - created_at) / 3600)::numeric, 1) from public.verification_requests where reviewed_at >= t0 and reviewed_at < t1)),

    'ads', jsonb_build_object(
        'live', (select count(*) from public.ad_campaigns where status = 'approved' and now() between starts_at and ends_at),
        'views', (select coalesce(sum(views), 0) from public.ad_daily_stats where day between d_from and d_to),
        'clicks', (select coalesce(sum(clicks), 0) from public.ad_daily_stats where day between d_from and d_to),
        'paid_inr', (select coalesce(sum(budget_inr), 0) from public.ad_campaigns where paid and created_at >= t0 and created_at < t1),
        'unpaid', coalesce((select jsonb_agg(x) from (select id, title, budget_inr, starts_at from public.ad_campaigns where status = 'approved' and not paid and ends_at > now() order by starts_at limit 6) x), '[]'::jsonb),
        'ending_soon', coalesce((select jsonb_agg(x) from (select id, title, ends_at from public.ad_campaigns where status = 'approved' and ends_at between now() and now() + interval '7 days' order by ends_at limit 6) x), '[]'::jsonb),
        'weekly', coalesce((select jsonb_agg(x order by x.week) from (
            select date_trunc('week', created_at at time zone 'Asia/Kolkata')::date as week, sum(budget_inr) as inr
            from public.ad_campaigns where paid and created_at >= t0 and created_at < t1 group by 1) x), '[]'::jsonb)),

    'health', jsonb_build_object(
        'errors_daily', (select jsonb_agg(jsonb_build_object('day', g.day, 'n', (select count(*) from public.client_errors e where (e.created_at at time zone 'Asia/Kolkata')::date = g.day)) order by g.day)
                         from (select generate_series(d_from, d_to, interval '1 day')::date as day) g),
        'top_errors', coalesce((select jsonb_agg(x) from (
            select left(message, 140) as message, count(*) as n, max(created_at) as last_seen from public.client_errors
            where created_at >= t0 and created_at < t1 group by left(message, 140) order by count(*) desc limit 5) x), '[]'::jsonb),
        'db_bytes', pg_database_size(current_database()),
        'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
        'push_devices', (select count(*) from public.push_subscriptions),
        'routes_without_stops', (select count(*) from public.bus_routes r where r.active and not exists (select 1 from public.bus_route_stops s where s.route_id = r.id))),

    'admins', coalesce((select jsonb_agg(x order by x.actions desc) from (
        select coalesce(p.display_name, 'Unknown') as name, count(*) as actions, max(a.created_at) as last_action
        from public.admin_audit a left join public.profiles p on p.id = a.actor_id
        where a.created_at >= t0 and a.created_at < t1 group by p.display_name) x), '[]'::jsonb)
  );

  -- Push delivery failures are only kept by pg_net for a few hours; skip quietly if unavailable.
  begin
    out := jsonb_set(out, '{health,push_failed_recent}', to_jsonb((select count(*) from net._http_response where status_code >= 400 or error_msg is not null)));
  exception when others then null;
  end;
  return out;
end;
$$;
revoke all on function public.admin_dashboard(integer, text, text, date, date) from public, anon;
grant execute on function public.admin_dashboard(integer, text, text, date, date) to authenticated;

-- More queues for the "needs attention" strip.
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
    'overdue',      (select count(*) from public.issues where status in ('pending', 'progress') and target_date < today and not hidden),
    'due_soon',     (select count(*) from public.issues where status in ('pending', 'progress') and target_date between today and today + 2 and not hidden),
    'reopened',     (select count(*) from public.issues where status in ('pending', 'progress') and reopen_count > 0 and not hidden),
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
