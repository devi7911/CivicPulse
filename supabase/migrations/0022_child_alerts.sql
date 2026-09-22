-- Missing-child (AMBER-style) alerts. Only admins publish, and only with a police FIR/complaint
-- reference, because a false alert can endanger a child (stalking, custody disputes). Alerts expire
-- after 72 hours unless renewed; when closed, the photo and description are removed. Sightings are
-- private to admins so they can be passed to the police.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alerts', 'alerts', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "admins upload alert photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'alerts' and (select public.is_admin()));
create policy "admins delete alert photos" on storage.objects for delete to authenticated
  using (bucket_id = 'alerts' and (select public.is_admin()));

create table public.child_alerts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 40),
  age integer check (age between 0 and 17),
  gender text check (gender is null or gender in ('girl', 'boy', 'other')),
  description text check (description is null or char_length(description) <= 500),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  last_seen_at timestamptz not null,
  last_seen_place text not null check (char_length(last_seen_place) between 3 and 120),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  police_station text not null check (char_length(police_station) between 3 and 80),
  police_phone text not null check (police_phone ~ '^\+?[0-9 -]{3,16}$'),
  fir_ref text not null check (char_length(fir_ref) between 3 and 60),
  status text not null default 'active' check (status in ('active', 'found', 'cancelled')),
  expires_at timestamptz not null default now() + interval '72 hours',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on public.child_alerts (status, expires_at);
alter table public.child_alerts enable row level security;
revoke all on public.child_alerts from anon, authenticated;
-- The public never sees the FIR number or who created the alert.
grant select (id, first_name, age, gender, description, photo_path, last_seen_at, last_seen_place, lat, lng,
  police_station, police_phone, status, expires_at, created_at) on public.child_alerts to anon, authenticated;
grant insert (first_name, age, gender, description, photo_path, last_seen_at, last_seen_place, lat, lng, police_station, police_phone, fir_ref)
  on public.child_alerts to authenticated;
grant update (first_name, age, gender, description, photo_path, last_seen_at, last_seen_place, lat, lng, police_station, police_phone, fir_ref, expires_at)
  on public.child_alerts to authenticated;
create policy "active alerts are public" on public.child_alerts for select
  using ((status = 'active' and expires_at > now()) or (select public.is_admin()));
create policy "admins publish alerts" on public.child_alerts for insert to authenticated with check ((select public.is_admin()));
create policy "admins edit alerts" on public.child_alerts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Admins see every alert with the FIR reference and creator.
create or replace function public.admin_child_alerts()
returns setof public.child_alerts
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select * from public.child_alerts order by (status = 'active') desc, created_at desc limit 50;
end;
$$;
revoke execute on function public.admin_child_alerts() from public, anon;
grant execute on function public.admin_child_alerts() to authenticated;

create or replace function public.child_alerts_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  new.status := 'active';
  new.created_at := now();
  new.expires_at := least(coalesce(new.expires_at, now() + interval '72 hours'), now() + interval '72 hours');
  if new.last_seen_at > now() + interval '10 minutes' then raise exception 'Last seen time cannot be in the future'; end if;
  return new;
end;
$$;
revoke execute on function public.child_alerts_before_insert() from public, anon, authenticated;
create trigger child_alerts_bi before insert on public.child_alerts for each row execute function public.child_alerts_before_insert();

-- Everyone with an account is notified (and pushed, via the notifications trigger).
create or replace function public.notify_child_alert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'amber', left('MISSING CHILD: ' || new.first_name || coalesce(', ' || new.age || ' yrs', ''), 140),
    left('Last seen ' || new.last_seen_place || '. If you see this child call 112 or ' || new.police_station || ' ' || new.police_phone || '.', 300)
  from public.profiles p join auth.users u on u.id = p.id
  where not coalesce(u.is_anonymous, false) and not p.banned;
  perform public.log_admin('publish', 'child_alerts', new.id::text, jsonb_build_object('fir', new.fir_ref, 'station', new.police_station));
  return new;
end;
$$;
revoke execute on function public.notify_child_alert() from public, anon, authenticated;
create trigger child_alerts_notify after insert on public.child_alerts for each row execute function public.notify_child_alert();

-- Close an alert. Identifying details are removed immediately; the photo file is deleted by the app.
create or replace function public.close_child_alert(p_id uuid, p_status text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  photo text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('found', 'cancelled') then raise exception 'Use found or cancelled'; end if;
  select photo_path into photo from public.child_alerts where id = p_id;
  update public.child_alerts set status = p_status, closed_at = now(), photo_path = null, description = null, lat = null, lng = null
  where id = p_id and status = 'active';
  if p_status = 'found' then
    insert into public.notifications (user_id, kind, title, body)
    select p.id, 'amber', 'Update: the missing child has been found', 'Thank you to everyone who shared and looked out.'
    from public.profiles p join auth.users u on u.id = p.id where not coalesce(u.is_anonymous, false) and not p.banned;
  end if;
  perform public.log_admin(p_status, 'child_alerts', p_id::text, '{}'::jsonb);
  return photo;
end;
$$;
revoke execute on function public.close_child_alert(uuid, text) from public, anon;
grant execute on function public.close_child_alert(uuid, text) to authenticated;

create or replace function public.renew_child_alert(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.child_alerts set expires_at = now() + interval '72 hours' where id = p_id and status = 'active';
  perform public.log_admin('renew', 'child_alerts', p_id::text, '{}'::jsonb);
end;
$$;
revoke execute on function public.renew_child_alert(uuid) from public, anon;
grant execute on function public.renew_child_alert(uuid) to authenticated;

-- Sightings: anyone may send one (no account needed); only admins can read them.
create table public.child_alert_sightings (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.child_alerts (id) on delete cascade,
  seen_at timestamptz not null,
  place text not null check (char_length(place) between 3 and 160),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  note text check (note is null or char_length(note) <= 500),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+?[0-9 -]{8,16}$'),
  reporter_id uuid,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index on public.child_alert_sightings (alert_id, created_at desc);
alter table public.child_alert_sightings enable row level security;
revoke all on public.child_alert_sightings from anon, authenticated;
grant insert (alert_id, seen_at, place, lat, lng, note, contact_phone) on public.child_alert_sightings to anon, authenticated;
grant select on public.child_alert_sightings to authenticated;
create policy "anyone can report a sighting" on public.child_alert_sightings for insert to anon, authenticated
  with check (exists (select 1 from public.child_alerts a where a.id = alert_id and a.status = 'active' and a.expires_at > now()));
create policy "admins read sightings" on public.child_alert_sightings for select to authenticated using ((select public.is_admin()));

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
  return new;
end;
$$;
revoke execute on function public.sightings_before_insert() from public, anon, authenticated;
create trigger sightings_bi before insert on public.child_alert_sightings for each row execute function public.sightings_before_insert();

-- Admins hear about every sighting immediately.
create or replace function public.notify_sighting()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body)
  select p.id, 'amber', 'New sighting reported', left(new.place || ' at ' || to_char(new.seen_at at time zone 'Asia/Kolkata', 'HH12:MI am, DD Mon') || '. Pass it to the police.', 300)
  from public.profiles p where p.role = 'admin';
  return new;
end;
$$;
revoke execute on function public.notify_sighting() from public, anon, authenticated;
create trigger sightings_notify after insert on public.child_alert_sightings for each row execute function public.notify_sighting();

-- Sighting reports are deleted 30 days after an alert closes (see purge job).
create or replace function private.purge_old_data()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.issue_reporter_contacts where created_at < now() - interval '12 months';
  delete from public.client_errors where created_at < now() - interval '30 days';
  delete from public.notifications where created_at < now() - interval '6 months';
  delete from private.ad_seen where day < (now() at time zone 'Asia/Kolkata')::date - 1;
  delete from public.child_alert_sightings s using public.child_alerts a
    where a.id = s.alert_id and a.closed_at is not null and a.closed_at < now() - interval '30 days';
  update public.child_alerts set status = 'cancelled', closed_at = now(), photo_path = null, description = null
    where status = 'active' and expires_at < now() - interval '7 days';
$$;
