-- Everything the admin command centre needs for one period, compared with the period before it.
create or replace function public.admin_dashboard(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 365);
  t0 timestamptz := now() - make_interval(days => d);       -- start of this period
  tp timestamptz := now() - make_interval(days => 2 * d);   -- start of the previous period
  today date := (now() at time zone 'Asia/Kolkata')::date;
  k jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  -- Headline numbers: [this period, previous period].
  k := jsonb_build_object(
    'reports',   jsonb_build_array((select count(*) from public.issues where created_at >= t0), (select count(*) from public.issues where created_at >= tp and created_at < t0)),
    'resolved',  jsonb_build_array((select count(*) from public.issues where resolved_at >= t0), (select count(*) from public.issues where resolved_at >= tp and resolved_at < t0)),
    'signups',   jsonb_build_array(
                   (select count(*) from auth.users where created_at >= t0 and not coalesce(is_anonymous, false)),
                   (select count(*) from auth.users where created_at >= tp and created_at < t0 and not coalesce(is_anonymous, false))),
    'days_to_fix', jsonb_build_array(
                   (select round(avg(extract(epoch from resolved_at - created_at) / 86400)::numeric, 1) from public.issues where resolved_at >= t0),
                   (select round(avg(extract(epoch from resolved_at - created_at) / 86400)::numeric, 1) from public.issues where resolved_at >= tp and resolved_at < t0)),
    'on_time',   jsonb_build_array(
                   (select round(100.0 * count(*) filter (where target_date is null or resolved_at::date <= target_date) / nullif(count(*), 0)) from public.issues where resolved_at >= t0),
                   (select round(100.0 * count(*) filter (where target_date is null or resolved_at::date <= target_date) / nullif(count(*), 0)) from public.issues where resolved_at >= tp and resolved_at < t0)),
    'active_people', jsonb_build_array(
                   (select count(distinct u) from (
                      select author_id u from public.issues where created_at >= t0 union all
                      select author_id from public.comments where created_at >= t0 union all
                      select user_id from public.issue_upvotes where created_at >= t0 union all
                      select user_id from public.event_rsvps where created_at >= t0) s),
                   (select count(distinct u) from (
                      select author_id u from public.issues where created_at >= tp and created_at < t0 union all
                      select author_id from public.comments where created_at >= tp and created_at < t0 union all
                      select user_id from public.issue_upvotes where created_at >= tp and created_at < t0 union all
                      select user_id from public.event_rsvps where created_at >= tp and created_at < t0) s))
  );

  return jsonb_build_object(
    'days', d,
    'kpis', k,
    -- One row per day (IST) in the period.
    'daily', (select jsonb_agg(jsonb_build_object(
        'day', g.day,
        'reported', (select count(*) from public.issues i where (i.created_at at time zone 'Asia/Kolkata')::date = g.day),
        'resolved', (select count(*) from public.issues i where (i.resolved_at at time zone 'Asia/Kolkata')::date = g.day),
        'signups',  (select count(*) from auth.users u where (u.created_at at time zone 'Asia/Kolkata')::date = g.day and not coalesce(u.is_anonymous, false))
      ) order by g.day)
      from (select generate_series(today - (d - 1), today, interval '1 day')::date as day) g),
    'status', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.issues where not hidden group by status) s),
    'severity_open', (select jsonb_object_agg(severity, n) from (select severity, count(*) n from public.issues where status in ('pending', 'progress') and not hidden group by severity) s),
    'map', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'ref_no', ref_no, 'title', title, 'status', status, 'lat', lat, 'lng', lng, 'category', category, 'upvote_count', upvote_count,
                       'target_date', target_date, 'severity', severity))
            from public.issues where status in ('pending', 'progress') and lat is not null and not hidden), '[]'::jsonb),
    'top_open', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, upvote_count, area, severity, assignee, (today - (created_at at time zone 'Asia/Kolkata')::date) as age_days
        from public.issues where status in ('pending', 'progress') and not hidden
        order by priority_score desc, upvote_count desc limit 6) x), '[]'::jsonb),
    'stale_unassigned', coalesce((select jsonb_agg(x) from (
        select id, ref_no, title, area, (today - (created_at at time zone 'Asia/Kolkata')::date) as age_days
        from public.issues where status in ('pending', 'progress') and assignee is null and not hidden
        order by created_at limit 6) x), '[]'::jsonb),
    'child_alerts', coalesce((select jsonb_agg(x) from (
        select a.id, a.first_name, a.age, a.last_seen_place, a.expires_at,
               (select count(*) from public.child_alert_sightings s where s.alert_id = a.id) as sightings
        from public.child_alerts a where a.status = 'active' order by a.created_at desc) x), '[]'::jsonb),
    'engagement', jsonb_build_object(
        'comments', (select count(*) from public.comments where created_at >= t0),
        'upvotes', (select count(*) from public.issue_upvotes where created_at >= t0),
        'rsvps', (select count(*) from public.event_rsvps where created_at >= t0),
        'contributions', (select count(*) from public.contributions where created_at >= t0),
        'events_upcoming', (select count(*) from public.events where starts_at > now())),
    'people', jsonb_build_object(
        'total', (select count(*) from public.profiles p join auth.users u on u.id = p.id where not coalesce(u.is_anonymous, false)),
        'verified', (select count(*) from public.profiles where verified),
        'banned', (select count(*) from public.profiles where banned),
        'by_type', (select jsonb_object_agg(account_type, n) from (
            select p.account_type, count(*) n from public.profiles p join auth.users u on u.id = p.id
            where not coalesce(u.is_anonymous, false) group by p.account_type) s)),
    'ads', jsonb_build_object(
        'live', (select count(*) from public.ad_campaigns where status = 'approved' and now() between starts_at and ends_at),
        'views', (select coalesce(sum(views), 0) from public.ad_daily_stats where day >= t0::date),
        'clicks', (select coalesce(sum(clicks), 0) from public.ad_daily_stats where day >= t0::date),
        'paid_inr', (select coalesce(sum(budget_inr), 0) from public.ad_campaigns where paid and created_at >= t0))
  );
end;
$$;
revoke all on function public.admin_dashboard(integer) from public, anon;
grant execute on function public.admin_dashboard(integer) to authenticated;
