-- Sighting spam protection must not depend on the network address being available.
-- Limits: 5 per hour per network (when known), and 40 per alert per 10 minutes overall.
create or replace function public.sightings_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who text := private.hash_signal(private.request_ip());
begin
  new.reporter_id := (select auth.uid());
  new.ip_hash := who;
  new.created_at := now();
  if who is not null and (select count(*) from public.child_alert_sightings where ip_hash = who and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many sighting reports from your network. If it is urgent, call 112 now.';
  end if;
  if (select count(*) from public.child_alert_sightings where alert_id = new.alert_id and created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'Many sightings are coming in right now. If it is urgent, call 112 now.';
  end if;
  return new;
end;
$$;
revoke execute on function public.sightings_before_insert() from public, anon, authenticated;
