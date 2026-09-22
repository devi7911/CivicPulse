-- Home dashboard data: weekly trend, trending reports, recently fixed (before/after) and petitions
-- close to their goal, plus "near me" ordering. Only public reports (not confidential, not hidden).

create or replace function public.dashboard_summary()
returns json
language sql stable security definer set search_path = ''
as $$
  with pub as (select * from public.issues where not confidential and not hidden)
  select json_build_object(
    'reported_7d', (select count(*) from pub where created_at >= now() - interval '7 days'),
    'reported_prev_7d', (select count(*) from pub where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
    'fixed_7d', (select count(*) from pub where status = 'resolved' and resolved_at >= now() - interval '7 days'),
    'avg_days_to_fix', (select round((avg(extract(epoch from resolved_at - created_at)) / 86400)::numeric, 1) from pub
      where status = 'resolved' and resolved_at >= now() - interval '90 days'),
    'trending', coalesce((select json_agg(t) from (
      select id, ref_no, title, category, status, upvote_count, comment_count, location_text
      from pub where status in ('pending', 'progress') and created_at >= now() - interval '30 days'
      order by upvote_count * 2 + comment_count desc, created_at desc limit 5) t), '[]'::json),
    'recently_fixed', coalesce((select json_agg(f) from (
      select id, ref_no, title, photo_path, resolved_photo_path, resolved_at, assignee
      from pub where status = 'resolved' and resolved_photo_path is not null
      order by resolved_at desc limit 6) f), '[]'::json),
    'petitions', coalesce((select json_agg(p) from (
      select id, title, support_count, threshold from public.proposals
      where status = 'open' and not hidden order by support_count::float / threshold desc, created_at desc limit 2) p), '[]'::json)
  );
$$;
grant execute on function public.dashboard_summary() to anon, authenticated;

-- Ids of public reports ordered by distance, for the "Near me" sort. The app then loads the reports
-- through the normal, access-controlled query.
create or replace function public.issues_near(p_lat double precision, p_lng double precision, p_limit integer default 30)
returns table (id uuid, distance_m double precision)
language sql stable security definer set search_path = ''
as $$
  select i.id, public.distance_m(p_lat, p_lng, i.lat, i.lng)
  from public.issues i
  where not i.confidential and not i.hidden and i.lat is not null
    and p_lat between -90 and 90 and p_lng between -180 and 180
  order by public.distance_m(p_lat, p_lng, i.lat, i.lng)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
grant execute on function public.issues_near(double precision, double precision, integer) to anon, authenticated;
