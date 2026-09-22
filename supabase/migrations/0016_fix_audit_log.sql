-- Two audit-log bugs found by end-to-end API tests:
-- 1. audit_row() logged every change to admin-managed tables, including automatic counter updates
--    caused by citizens (an RSVP updates events.rsvp_count), so citizens appeared as admin actors.
-- 2. When such a citizen deleted their account, the cascade tried to log an action by a profile that
--    was being deleted, violating admin_audit_actor_id_fkey, so "Delete my account" failed.
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record := case when tg_op = 'DELETE' then old else new end;
begin
  if (select auth.uid()) is null or not public.is_admin() then return r; end if;
  perform public.log_admin(lower(tg_op), tg_table_name, (to_jsonb(r) ->> 'id'),
    jsonb_build_object('title', coalesce(to_jsonb(r) ->> 'title', to_jsonb(r) ->> 'name')));
  return r;
end;
$$;

-- Never fail an action because the actor's profile no longer exists.
create or replace function public.log_admin(p_action text, p_type text, p_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.admin_audit (actor_id, action, target_type, target_id, details)
  values ((select id from public.profiles where id = (select auth.uid())), p_action, p_type, p_id, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function public.log_admin(text, text, text, jsonb) from public, anon, authenticated;
