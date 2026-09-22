-- CivicPulse rebuild: core schema, row-level security, server-side rules.
-- All game rules (points, tiers, comment limits, triage) live here so the
-- client can never award itself anything.

-- ---------- Enums ----------
create type public.user_role as enum ('citizen', 'admin');
create type public.issue_category as enum ('roads', 'waste', 'lighting', 'water', 'parks', 'other');
create type public.issue_status as enum ('pending', 'progress', 'resolved');
create type public.severity as enum ('low', 'medium', 'high');
create type public.event_category as enum ('public_health', 'civic_action', 'animal_welfare', 'children');

-- ---------- Profiles ----------
-- Public-safe fields only. Anything personal lives in profile_private.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  avatar_path text,
  role public.user_role not null default 'citizen',
  verified boolean not null default false,
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,13}$'),
  address text check (address is null or char_length(address) <= 300),
  area text check (area is null or char_length(area) <= 80),
  verified_method text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  phone text not null check (phone ~ '^\+?[0-9]{10,13}$'),
  created_at timestamptz not null default now()
);
create index on public.emergency_contacts (user_id);

-- ---------- Tiers ----------
create table public.tiers (
  name text primary key,
  min_points integer not null unique,
  title text not null,
  community_reward text not null
);

insert into public.tiers (name, min_points, title, community_reward) values
  ('Bronze',   0,   'Bronze Citizen',     'Your reports help your ward get attention faster.'),
  ('Silver',   100, 'Silver President',   '1 tree planted in your community.'),
  ('Gold',     300, 'Gold Guardian',      '5 trees planted and 1 street light audit in your community.'),
  ('Platinum', 700, 'Platinum Champion',  'A community clean-up drive sponsored in your ward.');

-- ---------- Issues ----------
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category public.issue_category not null,
  status public.issue_status not null default 'pending',
  photo_path text,
  resolved_photo_path text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  location_text text not null check (char_length(location_text) between 3 and 200),
  priority_score integer not null default 20 check (priority_score between 0 and 100),
  severity public.severity not null default 'low',
  assignee text check (assignee is null or char_length(assignee) <= 60),
  upvote_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.issues (created_at desc);
create index on public.issues (status, category, created_at desc);
create index on public.issues (author_id);
create index on public.issues (priority_score desc);

create table public.issue_upvotes (
  issue_id uuid not null references public.issues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index on public.issue_upvotes (user_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.comments (issue_id, created_at);
create index on public.comments (author_id, created_at);

create table public.issue_timeline (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  status public.issue_status not null,
  title text not null,
  note text not null default '',
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.issue_timeline (issue_id, created_at);
create index on public.issue_timeline (actor_id);

-- ---------- Events ----------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 5 and 120),
  description text not null check (char_length(description) between 10 and 2000),
  category public.event_category not null,
  child_friendly boolean not null default false,
  organizer text not null check (char_length(organizer) between 2 and 120),
  location_text text not null check (char_length(location_text) between 3 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer check (capacity is null or capacity > 0),
  rsvp_count integer not null default 0,
  children_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on public.events (starts_at);
create index on public.events (created_by);

-- Only a yes/no and a headcount are stored about children. Never names or ages.
create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  with_children boolean not null default false,
  children_count integer not null default 0 check (children_count between 0 and 10),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  check (with_children or children_count = 0)
);
create index on public.event_rsvps (user_id);

-- ---------- NGOs and sponsored posts ----------
create table public.ngos (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  website text check (website is null or website ~ '^https://'),
  donate_url text not null check (donate_url ~ '^https://'),
  vetted boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.sponsored_posts (
  id uuid primary key default gen_random_uuid(),
  ngo_id uuid not null references public.ngos (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  body text not null check (char_length(body) between 10 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.sponsored_posts (ngo_id);

-- ---------- Utilities ----------
create table public.helplines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  kind text not null default 'helpline' check (kind in ('helpline', 'police_station')),
  area text,                               -- null means city-wide
  address text,
  sort integer not null default 100
);
create index on public.helplines (area);

create table public.utility_links (
  id uuid primary key default gen_random_uuid(),
  category text not null,   -- electricity, challan, water, property_tax, other
  title text not null,
  description text not null default '',
  url text not null check (url ~ '^https://'),
  sort integer not null default 100
);

-- ---------- Points ledger ----------
create table public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index on public.points_ledger (user_id, created_at desc);

-- =====================================================================
-- Functions
-- =====================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Points are only ever written here. Positive awards are capped at 100 a day.
create or replace function public.award_points(p_user uuid, p_delta integer, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  earned_today integer;
  applied integer := p_delta;
begin
  if p_delta > 0 then
    select coalesce(sum(delta), 0) into earned_today
    from public.points_ledger
    where user_id = p_user and delta > 0 and created_at >= date_trunc('day', now());
    applied := least(p_delta, greatest(0, 100 - earned_today));
  end if;
  if applied = 0 then return; end if;

  insert into public.points_ledger (user_id, delta, reason) values (p_user, applied, p_reason);
  update public.profiles set points = greatest(0, points + applied) where id = p_user;
end;
$$;
revoke execute on function public.award_points(uuid, integer, text) from public, anon, authenticated;

-- New auth user -> profile rows.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  dn text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if char_length(dn) < 2 then dn := 'Citizen'; end if;
  insert into public.profiles (id, display_name) values (new.id, left(dn, 60));
  insert into public.profile_private (id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profile picture is a Verified-only feature.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.avatar_path is distinct from old.avatar_path and not old.verified then
    raise exception 'Profile pictures are available to verified users only';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Issue insert: force safe defaults, run triage, rate limit.
create or replace function public.issues_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  txt text := lower(new.title || ' ' || new.description);
  score integer;
  kw text;
  today_count integer;
begin
  select count(*) into today_count from public.issues
  where author_id = new.author_id and created_at >= now() - interval '1 day';
  if today_count >= 10 then
    raise exception 'Daily report limit reached. Please try again tomorrow.';
  end if;

  score := case new.category
    when 'water' then 50 when 'roads' then 40 when 'waste' then 30
    when 'lighting' then 25 else 20 end;
  foreach kw in array array['danger','hazard','risk','accident','harm','collapse','injury','toxic','poison'] loop
    if position(kw in txt) > 0 then score := score + 10; end if;
  end loop;
  foreach kw in array array['urgent','emergency','immediate','leak','flood','burst','electric shock','exposed wire'] loop
    if position(kw in txt) > 0 then score := score + 8; end if;
  end loop;
  foreach kw in array array['child','kids','elderly','school','hospital','baby'] loop
    if position(kw in txt) > 0 then score := score + 5; end if;
  end loop;
  score := least(100, score);

  new.priority_score := score;
  new.severity := (case when score >= 70 then 'high' when score >= 40 then 'medium' else 'low' end)::public.severity;
  new.status := 'pending';
  new.assignee := null;
  new.resolved_photo_path := null;
  new.upvote_count := 0;
  new.comment_count := 0;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
create trigger issues_bi before insert on public.issues
  for each row execute function public.issues_before_insert();

create or replace function public.issues_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.issue_timeline (issue_id, status, title, note, actor_id)
  values (new.id, 'pending', 'Reported',
          'Priority assessed as ' || upper(new.severity::text) || ' (' || new.priority_score || '/100).',
          new.author_id);
  perform public.award_points(new.author_id, 25, 'Reported an issue');
  return new;
end;
$$;
create trigger issues_ai after insert on public.issues
  for each row execute function public.issues_after_insert();

-- Status changes: legal transitions only, proof photo required to resolve.
create or replace function public.issues_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    if not ((old.status = 'pending' and new.status = 'progress')
         or (old.status = 'progress' and new.status = 'resolved')
         or (old.status = 'progress' and new.status = 'pending')) then
      raise exception 'Invalid status change from % to %', old.status, new.status;
    end if;
    if new.status = 'resolved' and new.resolved_photo_path is null then
      raise exception 'A resolution photo is required to resolve an issue';
    end if;
    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (new.id, new.status,
      case new.status when 'progress' then 'Work started' when 'resolved' then 'Resolved' else 'Moved back to pending' end,
      case new.status when 'resolved' then 'Proof photo uploaded.' else '' end,
      (select auth.uid()));
    if new.status = 'resolved' then
      perform public.award_points(old.author_id, 50, 'Your reported issue was resolved');
    end if;
  end if;
  if new.assignee is distinct from old.assignee and new.assignee is not null then
    insert into public.issue_timeline (issue_id, status, title, note, actor_id)
    values (new.id, new.status, 'Assigned', 'Assigned to ' || new.assignee, (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger issues_bu before update on public.issues
  for each row execute function public.issues_before_update();

-- Upvotes: atomic counter, one per user enforced by the primary key.
create or replace function public.upvotes_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.issues set upvote_count = upvote_count + 1 where id = new.issue_id;
    return new;
  else
    update public.issues set upvote_count = greatest(0, upvote_count - 1) where id = old.issue_id;
    return old;
  end if;
end;
$$;
create trigger upvotes_aiud after insert or delete on public.issue_upvotes
  for each row execute function public.upvotes_after_change();

-- Comments: max 3 per user per post, 30 a day.
create or replace function public.comments_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  on_post integer;
  today integer;
begin
  select count(*) into on_post from public.comments
  where issue_id = new.issue_id and author_id = new.author_id;
  if on_post >= 3 then
    raise exception 'Comment limit reached: 3 comments per post';
  end if;
  select count(*) into today from public.comments
  where author_id = new.author_id and created_at >= now() - interval '1 day';
  if today >= 30 then
    raise exception 'Daily comment limit reached';
  end if;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;
create trigger comments_bi before insert on public.comments
  for each row execute function public.comments_before_insert();

create or replace function public.comments_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.issues set comment_count = comment_count + 1 where id = new.issue_id;
    perform public.award_points(new.author_id, 5, 'Commented on an issue');
    return new;
  else
    update public.issues set comment_count = greatest(0, comment_count - 1) where id = old.issue_id;
    return old;
  end if;
end;
$$;
create trigger comments_aid after insert or delete on public.comments
  for each row execute function public.comments_after_change();

-- RSVPs: capacity check and counters.
create or replace function public.rsvps_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = new.event_id for update;
  if ev.ends_at < now() then raise exception 'This event has ended'; end if;
  if ev.capacity is not null and ev.rsvp_count + ev.children_count + 1 + new.children_count > ev.capacity then
    raise exception 'This event is full';
  end if;
  if new.children_count > 0 then new.with_children := true; end if;
  return new;
end;
$$;
create trigger rsvps_bi before insert on public.event_rsvps
  for each row execute function public.rsvps_before_insert();

create or replace function public.rsvps_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.events set rsvp_count = rsvp_count + 1,
      children_count = children_count + new.children_count where id = new.event_id;
    perform public.award_points(new.user_id, 15, 'Joined a community event');
    return new;
  else
    update public.events set rsvp_count = greatest(0, rsvp_count - 1),
      children_count = greatest(0, children_count - old.children_count) where id = old.event_id;
    return old;
  end if;
end;
$$;
create trigger rsvps_aid after insert or delete on public.event_rsvps
  for each row execute function public.rsvps_after_change();

-- Max 3 personal emergency contacts.
create or replace function public.emergency_contacts_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.emergency_contacts where user_id = new.user_id) >= 3 then
    raise exception 'You can save up to 3 emergency contacts';
  end if;
  return new;
end;
$$;
create trigger emergency_contacts_bi before insert on public.emergency_contacts
  for each row execute function public.emergency_contacts_before_insert();

-- Dashboard numbers without downloading every issue.
create or replace function public.issue_stats()
returns json
language sql stable set search_path = ''
as $$
  select json_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'progress', count(*) filter (where status = 'progress'),
    'resolved', count(*) filter (where status = 'resolved')
  ) from public.issues;
$$;

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.tiers enable row level security;
alter table public.issues enable row level security;
alter table public.issue_upvotes enable row level security;
alter table public.comments enable row level security;
alter table public.issue_timeline enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.ngos enable row level security;
alter table public.sponsored_posts enable row level security;
alter table public.helplines enable row level security;
alter table public.utility_links enable row level security;
alter table public.points_ledger enable row level security;

-- Column-level grants: users can only ever write the columns listed here.
-- Only CivicPulse's own tables are touched, so this is safe in a shared project.
revoke all on public.profiles, public.profile_private, public.emergency_contacts, public.tiers,
  public.issues, public.issue_upvotes, public.comments, public.issue_timeline, public.events,
  public.event_rsvps, public.ngos, public.sponsored_posts, public.helplines, public.utility_links,
  public.points_ledger from anon, authenticated;

grant select on public.profiles, public.tiers, public.issues, public.comments,
  public.issue_timeline, public.events, public.ngos, public.sponsored_posts,
  public.helplines, public.utility_links to anon, authenticated;
grant select on public.profile_private, public.emergency_contacts, public.issue_upvotes,
  public.event_rsvps, public.points_ledger to authenticated;

grant update (display_name, avatar_path) on public.profiles to authenticated;
grant update (phone, address, area) on public.profile_private to authenticated;
grant insert (user_id, name, phone), delete on public.emergency_contacts to authenticated;
grant insert (author_id, title, description, category, photo_path, lat, lng, location_text)
  on public.issues to authenticated;
grant update (status, assignee, resolved_photo_path) on public.issues to authenticated;
grant insert (issue_id, user_id), delete on public.issue_upvotes to authenticated;
grant insert (issue_id, author_id, body), delete on public.comments to authenticated;
grant insert (event_id, user_id, with_children, children_count), delete on public.event_rsvps to authenticated;
grant insert, update, delete on public.events, public.ngos, public.sponsored_posts,
  public.helplines, public.utility_links to authenticated;

-- profiles
create policy "profiles readable by all" on public.profiles for select using (true);
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- profile_private
create policy "read own private profile" on public.profile_private for select to authenticated
  using (id = (select auth.uid()));
create policy "update own private profile" on public.profile_private for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- emergency_contacts
create policy "read own contacts" on public.emergency_contacts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "add own contacts" on public.emergency_contacts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "delete own contacts" on public.emergency_contacts for delete to authenticated
  using (user_id = (select auth.uid()));

-- tiers
create policy "tiers readable by all" on public.tiers for select using (true);

-- issues
create policy "issues readable by all" on public.issues for select using (true);
create policy "report as self" on public.issues for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy "admins manage issues" on public.issues for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- upvotes: you can only see and change your own
create policy "read own upvotes" on public.issue_upvotes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "upvote as self" on public.issue_upvotes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "remove own upvote" on public.issue_upvotes for delete to authenticated
  using (user_id = (select auth.uid()));

-- comments
create policy "comments readable by all" on public.comments for select using (true);
create policy "comment as self" on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy "delete own comment or admin" on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- timeline (written by triggers only)
create policy "timeline readable by all" on public.issue_timeline for select using (true);

-- events
create policy "events readable by all" on public.events for select using (true);
create policy "admins insert events" on public.events for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update events" on public.events for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete events" on public.events for delete to authenticated
  using ((select public.is_admin()));

-- rsvps
create policy "read own rsvps or admin" on public.event_rsvps for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "rsvp as self" on public.event_rsvps for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "cancel own rsvp" on public.event_rsvps for delete to authenticated
  using (user_id = (select auth.uid()));

-- ngos and sponsored posts: public sees vetted + active only
create policy "vetted ngos readable" on public.ngos for select
  using (vetted or (select public.is_admin()));
create policy "admins insert ngos" on public.ngos for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update ngos" on public.ngos for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete ngos" on public.ngos for delete to authenticated
  using ((select public.is_admin()));

create policy "active sponsored posts readable" on public.sponsored_posts for select
  using (active or (select public.is_admin()));
create policy "admins insert sponsored" on public.sponsored_posts for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update sponsored" on public.sponsored_posts for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete sponsored" on public.sponsored_posts for delete to authenticated
  using ((select public.is_admin()));

-- helplines and utility links
create policy "helplines readable by all" on public.helplines for select using (true);
create policy "admins insert helplines" on public.helplines for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update helplines" on public.helplines for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete helplines" on public.helplines for delete to authenticated
  using ((select public.is_admin()));

create policy "links readable by all" on public.utility_links for select using (true);
create policy "admins insert links" on public.utility_links for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update links" on public.utility_links for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete links" on public.utility_links for delete to authenticated
  using ((select public.is_admin()));

-- points ledger
create policy "read own points" on public.points_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- =====================================================================
-- Storage: photos live in a bucket, never in the database
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files must be uploaded under a folder named after the uploader's user id.
create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =====================================================================
-- Seed: national helplines only. Station numbers are added by an admin.
-- =====================================================================
insert into public.helplines (name, phone, kind, sort) values
  ('Emergency (all services)', '112', 'helpline', 1),
  ('Police', '100', 'helpline', 2),
  ('Ambulance', '108', 'helpline', 3),
  ('Fire', '101', 'helpline', 4),
  ('Women helpline', '181', 'helpline', 5),
  ('Child helpline', '1098', 'helpline', 6);
