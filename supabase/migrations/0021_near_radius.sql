-- "Near me" with a radius (1, 3, 5 km or the whole city). Public reports only.
drop function if exists public.issues_near(double precision, double precision, integer);

create or replace function public.issues_near(p_lat double precision, p_lng double precision, p_limit integer default 30, p_radius_m integer default null)
returns table (id uuid, distance_m double precision)
language sql stable security definer set search_path = ''
as $$
  select i.id, d.m
  from public.issues i
  cross join lateral (select public.distance_m(p_lat, p_lng, i.lat, i.lng) as m) d
  where not i.confidential and not i.hidden and i.lat is not null
    and p_lat between -90 and 90 and p_lng between -180 and 180
    and (p_radius_m is null or d.m <= least(p_radius_m, 50000))
  order by d.m
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;
grant execute on function public.issues_near(double precision, double precision, integer, integer) to anon, authenticated;
