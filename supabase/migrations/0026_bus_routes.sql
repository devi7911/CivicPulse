-- Bus routes managed by CivicPulse admins (or a TGSRTC data partner), because TGSRTC publishes no open
-- route or live-arrival feed and OpenStreetMap maps only a handful of Hyderabad routes.
-- Times are the published schedule (first bus, last bus, frequency), not live positions.

create table public.bus_routes (
  id uuid primary key default gen_random_uuid(),
  number text not null check (char_length(number) between 1 and 12),
  from_name text not null check (char_length(from_name) between 2 and 80),
  to_name text not null check (char_length(to_name) between 2 and 80),
  first_bus time not null,
  last_bus time not null,
  frequency_min integer not null check (frequency_min between 2 and 240),
  service text check (service is null or char_length(service) <= 40), -- e.g. City Ordinary, Metro Express
  notes text check (notes is null or char_length(notes) <= 300),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.bus_routes (number);

create table public.bus_route_stops (
  route_id uuid not null references public.bus_routes (id) on delete cascade,
  seq integer not null check (seq between 1 and 300),
  name text not null check (char_length(name) between 2 and 100),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  minutes_from_start integer check (minutes_from_start is null or minutes_from_start between 0 and 600),
  osm_node bigint,
  primary key (route_id, seq)
);
create index on public.bus_route_stops (lat, lng);

alter table public.bus_routes enable row level security;
alter table public.bus_route_stops enable row level security;
revoke all on public.bus_routes, public.bus_route_stops from anon, authenticated;
grant select on public.bus_routes, public.bus_route_stops to anon, authenticated;
grant insert, update, delete on public.bus_routes, public.bus_route_stops to authenticated;

create policy "active routes are public" on public.bus_routes for select using (active or (select public.is_admin()));
create policy "admins add routes" on public.bus_routes for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit routes" on public.bus_routes for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete routes" on public.bus_routes for delete to authenticated using ((select public.is_admin()));

create policy "stops of visible routes are public" on public.bus_route_stops for select
  using (exists (select 1 from public.bus_routes r where r.id = route_id and (r.active or (select public.is_admin()))));
create policy "admins add route stops" on public.bus_route_stops for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit route stops" on public.bus_route_stops for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete route stops" on public.bus_route_stops for delete to authenticated using ((select public.is_admin()));

create trigger bus_routes_audit after insert or update or delete on public.bus_routes for each row execute function public.audit_row();

create or replace function public.bus_routes_touch()
returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger bus_routes_bu before update on public.bus_routes for each row execute function public.bus_routes_touch();

-- Stops of active routes within a radius, with each route's timings, for the Buses page.
create or replace function public.route_stops_near(p_lat double precision, p_lng double precision, p_radius_m integer default 700)
returns table (route_id uuid, number text, from_name text, to_name text, first_bus time, last_bus time, frequency_min integer,
  service text, seq integer, stop_name text, lat double precision, lng double precision, minutes_from_start integer, distance_m double precision)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.number, r.from_name, r.to_name, r.first_bus, r.last_bus, r.frequency_min, r.service,
    s.seq, s.name, s.lat, s.lng, s.minutes_from_start, d.m
  from public.bus_route_stops s
  join public.bus_routes r on r.id = s.route_id and r.active
  cross join lateral (select public.distance_m(p_lat, p_lng, s.lat, s.lng) as m) d
  where s.lat between p_lat - 0.05 and p_lat + 0.05 and s.lng between p_lng - 0.05 and p_lng + 0.05
    and d.m <= least(greatest(coalesce(p_radius_m, 700), 100), 3000)
  order by d.m
  limit 400;
$$;
grant execute on function public.route_stops_near(double precision, double precision, integer) to anon, authenticated;

-- Replace a route's stops in one step (admin only), so the order is never half-saved.
create or replace function public.set_route_stops(p_route uuid, p_stops jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) < 2 then raise exception 'A route needs at least 2 stops'; end if;
  delete from public.bus_route_stops where route_id = p_route;
  insert into public.bus_route_stops (route_id, seq, name, lat, lng, minutes_from_start, osm_node)
  select p_route, (e.ord)::int, trim(e.v ->> 'name'), (e.v ->> 'lat')::double precision, (e.v ->> 'lng')::double precision,
    nullif(e.v ->> 'minutes', '')::int, nullif(e.v ->> 'osm', '')::bigint
  from jsonb_array_elements(p_stops) with ordinality as e(v, ord);
  update public.bus_routes set updated_at = now() where id = p_route;
  perform public.log_admin('set_stops', 'bus_routes', p_route::text, jsonb_build_object('stops', jsonb_array_length(p_stops)));
end;
$$;
revoke execute on function public.set_route_stops(uuid, jsonb) from public, anon;
grant execute on function public.set_route_stops(uuid, jsonb) to authenticated;
