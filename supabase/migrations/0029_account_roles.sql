-- Account types now carry permissions, enforced here rather than in the app:
--  * Verified community groups, NGOs, schools/colleges and government bodies can publish events.
--  * Organisations must verify with proof of the organisation; individuals with a personal ID.
--  * Accounts created without the sign-up form (e.g. Google sign-in) complete their details once.
--  * Admins can see and correct account types.

-- ---------------------------------------------------------------------------------------------
-- Complete profile (Google sign-in and older accounts): set type, phone and address once.
-- ---------------------------------------------------------------------------------------------
create or replace function public.complete_my_profile(p_account_type text, p_org_name text, p_phone text, p_address text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  ph text := private.clean_phone(p_phone);
  cur record;
begin
  if me is null or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then raise exception 'Sign in first'; end if;
  if p_account_type not in ('individual', 'community', 'ngo', 'education', 'business', 'government') then raise exception 'Choose an account type'; end if;
  if ph is null then raise exception 'Please enter a valid 10-digit Indian mobile number.'; end if;
  if char_length(trim(coalesce(p_address, ''))) < 10 then raise exception 'Please enter your full address.'; end if;
  if p_account_type <> 'individual' and char_length(trim(coalesce(p_org_name, ''))) < 2 then raise exception 'Please enter the organisation name.'; end if;
  select p.verified, pp.phone into cur from public.profiles p join public.profile_private pp on pp.id = p.id where p.id = me;
  -- The account type can only be chosen while the profile is incomplete and unverified.
  if cur.phone is null and not cur.verified then
    update public.profiles set account_type = p_account_type,
      org_name = case when p_account_type = 'individual' then null else left(trim(p_org_name), 100) end
    where id = me;
  end if;
  update public.profile_private set phone = ph, address = left(trim(p_address), 300) where id = me;
end;
$$;
revoke execute on function public.complete_my_profile(text, text, text, text) from public, anon;
grant execute on function public.complete_my_profile(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Verification documents must match the account type.
-- ---------------------------------------------------------------------------------------------
create or replace function public.verification_matches_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text := (select account_type from public.profiles where id = new.user_id);
begin
  if kind = 'individual' and new.doc_type = 'org_registration' then
    raise exception 'Individuals verify with a personal ID such as the masked Aadhaar.';
  elsif kind = 'government' and new.doc_type not in ('org_registration', 'other_govt_id') then
    raise exception 'Government bodies verify with an official letter or office ID.';
  elsif kind in ('community', 'ngo', 'education', 'business') and new.doc_type <> 'org_registration' then
    raise exception 'Organisations verify with their registration certificate (society, trust, company or school registration).';
  end if;
  return new;
end;
$$;
revoke execute on function public.verification_matches_account() from public, anon, authenticated;
create trigger verification_matches_account_bi before insert on public.verification_requests
  for each row execute function public.verification_matches_account();

-- ---------------------------------------------------------------------------------------------
-- Events by verified organisations
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_host_events()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.verified and not p.banned
    and p.account_type in ('community', 'ngo', 'education', 'government'));
$$;
grant execute on function public.can_host_events() to authenticated;

create policy "verified organisations publish events" on public.events for insert to authenticated
  with check ((select public.can_host_events()) and created_by = (select auth.uid()));
create policy "organisations edit own events" on public.events for update to authenticated
  using (created_by = (select auth.uid()) and (select public.can_host_events()))
  with check (created_by = (select auth.uid()));
create policy "organisations delete own events" on public.events for delete to authenticated
  using (created_by = (select auth.uid()));

create or replace function public.events_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  org text;
begin
  if public.is_admin() then return new; end if;
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
$$;
revoke execute on function public.events_guard() from public, anon, authenticated;
create trigger events_guard_biu before insert or update on public.events for each row execute function public.events_guard();

-- ---------------------------------------------------------------------------------------------
-- Admin: see and correct account types
-- ---------------------------------------------------------------------------------------------
drop function if exists public.admin_list_users(text);
create or replace function public.admin_list_users(p_query text default null)
returns table (id uuid, display_name text, email text, role public.user_role, banned boolean, verified boolean,
  points integer, reports bigint, is_guest boolean, created_at timestamptz, account_type text, org_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query
  select p.id, p.display_name, u.email::text, p.role, p.banned, p.verified, p.points,
    (select count(*) from public.issues i where i.author_id = p.id), coalesce(u.is_anonymous, false), p.created_at, p.account_type, p.org_name
  from public.profiles p join auth.users u on u.id = p.id
  where p_query is null or p_query = ''
     or p.display_name ilike '%' || p_query || '%' or u.email ilike '%' || p_query || '%' or p.org_name ilike '%' || p_query || '%'
  order by p.created_at desc
  limit 50;
end;
$$;
revoke execute on function public.admin_list_users(text) from public, anon;
grant execute on function public.admin_list_users(text) to authenticated;

create or replace function public.admin_set_account_type(p_user uuid, p_account_type text, p_org_name text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_account_type not in ('individual', 'community', 'ngo', 'education', 'business', 'government') then raise exception 'Unknown account type'; end if;
  update public.profiles set account_type = p_account_type,
    org_name = case when p_account_type = 'individual' then null else coalesce(nullif(trim(p_org_name), ''), org_name) end,
    -- Changing what an account claims to be requires verifying again.
    verified = case when account_type = p_account_type then verified else false end
  where id = p_user;
  perform public.log_admin('set_account_type', 'profiles', p_user::text, jsonb_build_object('account_type', p_account_type, 'org_name', p_org_name));
end;
$$;
revoke execute on function public.admin_set_account_type(uuid, text, text) from public, anon;
grant execute on function public.admin_set_account_type(uuid, text, text) to authenticated;
