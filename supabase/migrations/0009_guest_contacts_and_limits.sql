-- Reporting without an account now requires a name, email and phone number. They are kept private
-- (admins only), and the report can still be shown anonymously. They also drive the anti-spam limit:
-- 3 reports per rolling 30 days per email, phone number or device, plus a per-network cap.
--
-- Why 30 days: in the FixMyStreet Brussels study 67% of users reported only one issue ever, so
-- 3 a month is generous for a resident without an account; frequent reporters should create one.
-- Browsers cannot read MAC addresses or hardware IDs, so the signals are email, phone, a device ID
-- kept in the browser, and the network address. Network addresses are only stored as salted hashes,
-- and the per-network cap is loose because many Indian mobile users share one address (CGNAT).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_secrets (key text primary key, value text not null);
insert into private.app_secrets (key, value)
values ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function private.hash_signal(p_value text)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when coalesce(trim(p_value), '') = '' then null else
    encode(extensions.digest((select value from private.app_secrets where key = 'ip_salt') || lower(trim(p_value)), 'sha256'), 'hex') end;
$$;

-- The caller's network address as seen by Supabase's edge (Cloudflare sets this; clients cannot).
create or replace function private.request_ip()
returns text
language sql stable set search_path = ''
as $$
  select nullif(trim(coalesce(
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1))), '');
$$;

-- Private contact details for reports filed without an account. Admins only.
create table public.issue_reporter_contacts (
  issue_id uuid primary key references public.issues (id) on delete cascade deferrable initially deferred,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text not null,
  phone text not null,
  device_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index on public.issue_reporter_contacts (email, created_at desc);
create index on public.issue_reporter_contacts (phone, created_at desc);
create index on public.issue_reporter_contacts (device_hash, created_at desc);
create index on public.issue_reporter_contacts (ip_hash, created_at desc);
create index on public.issue_reporter_contacts (user_id);

alter table public.issue_reporter_contacts enable row level security;
revoke all on public.issue_reporter_contacts from anon, authenticated;
grant select on public.issue_reporter_contacts to authenticated;
create policy "admins read reporter contacts" on public.issue_reporter_contacts for select to authenticated
  using ((select public.is_admin()));

-- Write-only fields on issues: the form sends them, the trigger moves them into the private table
-- and clears them, so they are never stored on the public row.
alter table public.issues
  add column guest_name text,
  add column guest_email text,
  add column guest_phone text,
  add column device_id text;
grant insert (guest_name, guest_email, guest_phone, device_id) on public.issues to authenticated;

create or replace function public.check_report_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  guest boolean := public.is_guest(new.author_id);
  v_name text := trim(coalesce(new.guest_name, ''));
  v_email text := lower(trim(coalesce(new.guest_email, '')));
  v_phone text := regexp_replace(coalesce(new.guest_phone, ''), '[^0-9]', '', 'g');
  v_device text := private.hash_signal(new.device_id);
  v_ip text := private.hash_signal(private.request_ip());
  recent integer;
  guest_hour integer;
begin
  if guest then
    if char_length(v_name) < 2 or char_length(v_name) > 60 then
      raise exception 'Please enter your name (2 to 60 characters).';
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or char_length(v_email) > 120 then
      raise exception 'Please enter a valid email address.';
    end if;
    -- Indian mobile numbers: 10 digits starting 6-9, with or without the 91 country code.
    if v_phone ~ '^91[6-9][0-9]{9}$' then v_phone := substr(v_phone, 3); end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'Please enter a valid 10-digit Indian mobile number.';
    end if;
    v_phone := '+91' || v_phone;

    select count(*) into recent from public.issue_reporter_contacts c
    where c.created_at >= now() - interval '30 days'
      and (c.email = v_email or c.phone = v_phone or (v_device is not null and c.device_hash = v_device));
    if recent >= 3 then
      raise exception 'Without an account you can file 3 reports every 30 days, and this email, phone or device has reached that. Create a free account to report more.';
    end if;

    if v_ip is not null then
      select count(*) into recent from public.issue_reporter_contacts c
      where c.ip_hash = v_ip and c.created_at >= now() - interval '1 day';
      if recent >= 10 then
        raise exception 'Too many reports from your network today. Please try again tomorrow, or create a free account.';
      end if;
    end if;

    select count(*) into guest_hour from public.issue_reporter_contacts c where c.created_at >= now() - interval '1 hour';
    if guest_hour >= 60 then
      raise exception 'Too many reports without an account right now. Please try again shortly, or sign in.';
    end if;

    insert into public.issue_reporter_contacts (issue_id, user_id, name, email, phone, device_hash, ip_hash)
    values (new.id, new.author_id, v_name, v_email, v_phone, v_device, v_ip);

    -- Shown on the report unless the person ticks "report anonymously".
    update public.profiles set display_name = v_name where id = new.author_id;
  end if;

  new.guest_name := null;
  new.guest_email := null;
  new.guest_phone := null;
  new.device_id := null;
  return new;
end;
$$;
revoke execute on function public.check_report_limits() from public, anon, authenticated;
