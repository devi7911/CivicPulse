-- Keep the big dashboard query private and add each map pin's area for the hotspot list.
alter function public.admin_dashboard(integer, text, text, date, date) rename to admin_dashboard_core;
alter function public.admin_dashboard_core(integer, text, text, date, date) set schema private;
revoke all on function private.admin_dashboard_core(integer, text, text, date, date) from public, anon, authenticated;

create or replace function public.admin_dashboard(
  p_days integer default 30, p_area text default null, p_category text default null, p_from date default null, p_to date default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  out jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  out := private.admin_dashboard_core(p_days, p_area, p_category, p_from, p_to);
  -- Each map pin carries its area, for the hotspot list.
  return jsonb_set(out, '{map}', coalesce((
    select jsonb_agg(m || jsonb_build_object('area', i.area))
    from jsonb_array_elements(out -> 'map') m join public.issues i on i.id = (m ->> 'id')::uuid), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_dashboard(integer, text, text, date, date) from public, anon;
grant execute on function public.admin_dashboard(integer, text, text, date, date) to authenticated;
