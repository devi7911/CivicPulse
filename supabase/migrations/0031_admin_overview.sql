-- One call for the admin Overview page: work waiting in each queue, plus recent admin activity.
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
    'petitions',    (select count(*) from public.proposals where status = 'threshold' and not hidden),
    'overdue',      (select count(*) from public.issues where status in ('pending', 'progress') and target_date < today and not hidden),
    'unassigned',   (select count(*) from public.issues where status in ('pending', 'progress') and assignee is null and not hidden),
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
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
