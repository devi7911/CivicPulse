-- Ticket figures for the dashboard, now including how many tickets an admin is working on.
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
