-- events_guard froze rsvp_count on every non-admin UPDATE, including the nested
-- update from rsvps_after_change, so RSVPs never moved the count.
create or replace function public.events_guard() returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  org text;
begin
  if public.is_admin() then return new; end if;
  -- Count updates made by the RSVP trigger run nested; let those through.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.rsvp_count := 0; new.children_count := 0; new.created_at := now();
    select org_name into org from public.profiles where id = new.created_by;
    new.organizer := coalesce(org, new.organizer);
    if (select count(*) from public.events where created_by = new.created_by and created_at > now() - interval '30 days') >= 5 then
      raise exception 'Organisations can publish 5 events every 30 days.';
    end if;
    if new.starts_at < now() - interval '1 hour' then raise exception 'The event must be in the future.'; end if;
  else
    new.created_by := old.created_by; new.rsvp_count := old.rsvp_count; new.children_count := old.children_count;
    new.created_at := old.created_at; new.organizer := old.organizer;
  end if;
  return new;
end;
$function$;
