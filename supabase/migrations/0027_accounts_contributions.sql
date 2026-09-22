-- Account types, required sign-up details, masked-Aadhaar verification and the Community contribution feed.

-- ---------------------------------------------------------------------------------------------
-- Account types
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column account_type text not null default 'individual'
    check (account_type in ('individual', 'community', 'ngo', 'education', 'business', 'government')),
  add column org_name text check (org_name is null or char_length(org_name) between 2 and 100);
grant select (account_type, org_name) on public.profiles to anon, authenticated;
grant update (org_name) on public.profiles to authenticated;

-- Sign-up details come from the sign-up form (auth metadata). An invalid phone is stored as empty
-- rather than blocking the account; the app requires and validates it before sending.
create or replace function private.clean_phone(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') ~ '^91[6-9][0-9]{9}$' then '+' || regexp_replace(p, '[^0-9]', '', 'g')
    when regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') ~ '^[6-9][0-9]{9}$' then '+91' || regexp_replace(p, '[^0-9]', '', 'g')
    else null end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  dn text := trim(coalesce(md ->> 'display_name', ''));
  kind text := coalesce(md ->> 'account_type', 'individual');
  org text := nullif(trim(coalesce(md ->> 'org_name', '')), '');
begin
  if new.is_anonymous then dn := 'Guest citizen'; end if;
  if char_length(dn) < 2 then dn := 'Citizen'; end if;
  if kind not in ('individual', 'community', 'ngo', 'education', 'business', 'government') then kind := 'individual'; end if;
  if kind = 'individual' or char_length(coalesce(org, '')) < 2 then org := null; end if;
  insert into public.profiles (id, display_name, account_type, org_name) values (new.id, left(dn, 60), kind, left(org, 100));
  insert into public.profile_private (id, phone, address)
  values (new.id, private.clean_phone(md ->> 'phone'), left(nullif(trim(coalesce(md ->> 'address', '')), ''), 300));
  return new;
end;
$$;

create or replace function public.handle_user_upgraded()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  dn text := trim(coalesce(md ->> 'display_name', ''));
  kind text := coalesce(md ->> 'account_type', 'individual');
begin
  if old.is_anonymous and not new.is_anonymous then
    if char_length(dn) >= 2 then
      update public.profiles set display_name = left(dn, 60) where id = new.id and display_name = 'Guest citizen';
    end if;
    if kind in ('individual', 'community', 'ngo', 'education', 'business', 'government') then
      update public.profiles set account_type = kind,
        org_name = case when kind = 'individual' then null else left(nullif(trim(coalesce(md ->> 'org_name', '')), ''), 100) end
      where id = new.id;
    end if;
    update public.profile_private set
      phone = coalesce(private.clean_phone(md ->> 'phone'), phone),
      address = coalesce(left(nullif(trim(coalesce(md ->> 'address', '')), ''), 300), address)
    where id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Verification with UIDAI's masked Aadhaar (only the last 4 digits). The full Aadhaar number is never
-- collected: under the Aadhaar Act only licensed agencies may collect or store it.
-- ---------------------------------------------------------------------------------------------
alter table public.verification_requests drop constraint verification_requests_doc_type_check;
alter table public.verification_requests add constraint verification_requests_doc_type_check
  check (doc_type in ('masked_aadhaar', 'driving_licence', 'voter_id', 'passport', 'pan_card', 'other_govt_id', 'org_registration'));
alter table public.verification_requests
  add column aadhaar_last4 text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  add constraint masked_aadhaar_needs_last4 check (doc_type <> 'masked_aadhaar' or aadhaar_last4 is not null);
grant insert (aadhaar_last4) on public.verification_requests to authenticated;

-- A 12-digit number typed anywhere in the request is refused, as a safety net.
create or replace function public.verification_no_full_aadhaar()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(new.note, '') ~ '[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}' then
    raise exception 'Do not type your full Aadhaar number. Enter only the last 4 digits.';
  end if;
  return new;
end;
$$;
create trigger verification_no_full_aadhaar_biu before insert or update on public.verification_requests
  for each row execute function public.verification_no_full_aadhaar();

-- ---------------------------------------------------------------------------------------------
-- Community contributions: verified people and organisations share what they did for the city.
-- Limits stop self-promotion: individuals 1 per 7 days and 3 per 30 days; organisations 3 per 7 days
-- and 10 per 30 days.
-- ---------------------------------------------------------------------------------------------
create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('achievement', 'drive', 'volunteering', 'donation', 'fixed', 'other')),
  title text not null check (char_length(title) between 5 and 100),
  body text not null check (char_length(body) between 10 and 600),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  issue_id uuid references public.issues (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  applause_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.contributions (created_at desc);
create index on public.contributions (author_id, created_at desc);

create table public.contribution_applause (
  contribution_id uuid not null references public.contributions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contribution_id, user_id)
);

alter table public.contributions enable row level security;
alter table public.contribution_applause enable row level security;
revoke all on public.contributions, public.contribution_applause from anon, authenticated;
grant select on public.contributions to anon, authenticated;
grant insert (author_id, kind, title, body, photo_path, issue_id, event_id) on public.contributions to authenticated;
grant delete on public.contributions to authenticated;
grant select, delete on public.contribution_applause to authenticated;
grant insert (contribution_id, user_id) on public.contribution_applause to authenticated;

create policy "contributions readable unless hidden" on public.contributions for select
  using (not hidden or author_id = (select auth.uid()) or (select public.is_admin()));
create policy "verified accounts share" on public.contributions for insert to authenticated
  with check (author_id = (select auth.uid())
    and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    and not (select public.is_banned())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.verified));
create policy "delete own contribution or admin" on public.contributions for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

create policy "own applause" on public.contribution_applause for select to authenticated using (user_id = (select auth.uid()));
create policy "applaud as self" on public.contribution_applause for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) and not (select public.is_banned()));
create policy "remove own applause" on public.contribution_applause for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.contributions_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text;
  wk integer;
  mo integer;
begin
  new.applause_count := 0; new.hidden := false; new.created_at := now();
  if public.is_admin() then return new; end if;
  select account_type into kind from public.profiles where id = new.author_id;
  select count(*) filter (where created_at > now() - interval '7 days'), count(*)
    into wk, mo from public.contributions where author_id = new.author_id and created_at > now() - interval '30 days';
  if kind = 'individual' and (wk >= 1 or mo >= 3) then
    raise exception 'You can share 1 contribution a week (3 a month). This keeps the tab about the community, not self-promotion.';
  elsif kind <> 'individual' and (wk >= 3 or mo >= 10) then
    raise exception 'Organisations can share 3 contributions a week (10 a month).';
  end if;
  -- An "achievement" must be backed by something real: points earned in the app.
  if new.kind = 'achievement' and not exists (select 1 from public.profiles where id = new.author_id and points >= 50) then
    raise exception 'Achievements can be shared after earning 50 points by reporting and helping.';
  end if;
  return new;
end;
$$;
revoke execute on function public.contributions_before_insert() from public, anon, authenticated;
create trigger contributions_bi before insert on public.contributions for each row execute function public.contributions_before_insert();

create or replace function public.applause_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select author_id from public.contributions where id = new.contribution_id) = new.user_id then
      raise exception 'You cannot applaud your own post';
    end if;
    update public.contributions set applause_count = applause_count + 1 where id = new.contribution_id;
    return new;
  end if;
  update public.contributions set applause_count = greatest(0, applause_count - 1) where id = old.contribution_id;
  return old;
end;
$$;
revoke execute on function public.applause_after_change() from public, anon, authenticated;
create trigger applause_aid after insert or delete on public.contribution_applause for each row execute function public.applause_after_change();

-- Moderation covers contributions too.
alter table public.content_flags drop constraint if exists content_flags_target_type_check;
alter table public.content_flags add constraint content_flags_target_type_check check (target_type in ('issue', 'comment', 'proposal', 'contribution'));

create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_type = 'issue' then
    update public.issues set hidden = p_hide, hidden_reason = case when p_hide then left(coalesce(p_reason, 'Hidden by a moderator.'), 200) end where id = p_id;
  elsif p_type = 'comment' then
    update public.comments set hidden = p_hide where id = p_id;
  elsif p_type = 'proposal' then
    update public.proposals set hidden = p_hide where id = p_id;
  elsif p_type = 'contribution' then
    update public.contributions set hidden = p_hide where id = p_id;
  else
    raise exception 'Unknown content type';
  end if;
  update public.content_flags set status = case when p_hide then 'actioned' else 'dismissed' end
  where target_type = p_type and target_id = p_id and status = 'open';
  perform public.log_admin(case when p_hide then 'hide' else 'unhide' end, p_type, p_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.flags_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  select count(*) into n from public.content_flags
  where target_type = new.target_type and target_id = new.target_id and status = 'open';
  if n >= 5 then
    if new.target_type = 'issue' then
      update public.issues set hidden = true, hidden_reason = 'Hidden automatically after several reports. Awaiting review.' where id = new.target_id and not hidden;
    elsif new.target_type = 'comment' then
      update public.comments set hidden = true where id = new.target_id;
    elsif new.target_type = 'contribution' then
      update public.contributions set hidden = true where id = new.target_id;
    end if;
  end if;
  return new;
end;
$$;
