-- Email alerts, using Resend's free tier (3,000 emails/month, no card). Two independent opt-ins:
--   1. A guest reporter can choose "by email" instead of "on this device" when filing a report —
--      solves the real problem that a guest session only exists on the one browser that made it.
--   2. A signed-in person can turn on "email me" once in their profile and it applies to every
--      report they follow.
-- Sending is fire-and-forget (pg_net, like the existing push notifications) so a status change or a
-- staff reply is never slowed down waiting on an email API call.

-- Run once, from the SQL editor, after creating a free Resend account and an API key:
--   select vault.create_secret('<your key>', 'resend_key', 'Resend API key for email alerts');
-- Optional overrides (skip these to use the defaults):
--   select vault.create_secret('CivicPulse <alerts@your-domain.example>', 'resend_from', 'Verified sending address');
--   select vault.create_secret('https://your-deployed-domain.example', 'app_url', 'Public site URL used in email links');
create or replace function private.resend_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_key'
$$;
create or replace function private.resend_from() returns text
language sql stable security definer set search_path = '' as $$
  -- Resend's shared sandbox address; works with no domain setup but looks like it. Verify your own
  -- domain with Resend and set 'resend_from' in Vault once you have one.
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'resend_from'), 'CivicPulse <onboarding@resend.dev>')
$$;
create or replace function private.app_url() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), 'http://localhost:5180')
$$;

-- Queues an email; does not wait for it to actually send. Silently does nothing if no Resend key
-- is set up yet, so this is safe to call before that's configured.
create or replace function private.send_email(p_to text, p_subject text, p_html text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  key text := private.resend_key();
begin
  if key is null or key = '' or p_to is null or p_to = '' then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body := jsonb_build_object('from', private.resend_from(), 'to', jsonb_build_array(p_to), 'subject', left(p_subject, 200), 'html', p_html)
  );
exception when others then
  -- An email that fails to queue should never break whatever the citizen or admin was doing.
  null;
end;
$$;

-- A guest reporter's choice, sent with the report and never stored in the row itself.
alter table public.issues add column if not exists guest_email_alerts boolean;
grant insert (guest_email_alerts) on public.issues to authenticated;

-- A guest's standing choice for this one report.
alter table public.issue_reporter_contacts add column if not exists email_alerts boolean not null default false;

-- A signed-in person's standing choice, for everything they follow.
alter table public.profiles add column if not exists email_alerts boolean not null default false;
grant update (email_alerts) on public.profiles to authenticated;

create or replace function public.check_report_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  guest boolean := public.is_guest(new.author_id);
  v_name text := trim(coalesce(new.guest_name, ''));
  v_email text := lower(trim(coalesce(new.guest_email, '')));
  v_phone text := regexp_replace(coalesce(new.guest_phone, ''), '[^0-9]', '', 'g');
  v_device text := private.hash_signal(new.device_id);
  v_ip text := private.hash_signal(private.request_ip());
  h_email text;
  h_phone text;
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
    if v_phone ~ '^91[6-9][0-9]{9}$' then v_phone := substr(v_phone, 3); end if;
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'Please enter a valid 10-digit Indian mobile number.';
    end if;
    v_phone := '+91' || v_phone;
    h_email := private.hash_signal('email:' || v_email);
    h_phone := private.hash_signal('phone:' || v_phone);

    select count(*) into recent from public.issue_reporter_contacts c
    where c.created_at >= now() - interval '30 days'
      and (c.email_hash = h_email or c.phone_hash = h_phone or (v_device is not null and c.device_hash = v_device));
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

    insert into public.issue_reporter_contacts (issue_id, user_id, name_enc, email_enc, phone_enc, email_hash, phone_hash, device_hash, ip_hash, email_alerts)
    values (new.id, new.author_id, private.enc(v_name), private.enc(v_email), private.enc(v_phone), h_email, h_phone, v_device, v_ip, coalesce(new.guest_email_alerts, false));

    update public.profiles set display_name = v_name where id = new.author_id;
  end if;

  new.guest_name := null;
  new.guest_email := null;
  new.guest_phone := null;
  new.device_id := null;
  new.guest_email_alerts := null;
  return new;
end;
$$;

-- Same recipients as before, but each one who opted into email also gets one, queued (not sent
-- inline), so a comment or status change is never slowed down waiting on an email API call.
create or replace function public.notify_issue(p_issue uuid, p_kind text, p_title text, p_body text, p_except uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  link text := private.app_url() || '/issues/' || p_issue;
  r record;
begin
  insert into public.notifications (user_id, issue_id, kind, title, body)
  select distinct u.id, p_issue, p_kind, left(p_title, 140), left(p_body, 300)
  from (
    select author_id as id from public.issues where id = p_issue
    union
    select user_id from public.issue_follows where issue_id = p_issue
  ) u
  where u.id is not null and u.id is distinct from p_except;

  for r in
    select distinct u.id from (
      select author_id as id from public.issues where id = p_issue
      union
      select user_id from public.issue_follows where issue_id = p_issue
    ) u
    where u.id is not null and u.id is distinct from p_except
  loop
    -- A registered person who turned on email alerts.
    perform private.send_email(au.email, p_title, '<p>' || p_body || '</p><p><a href="' || link || '">Open the report</a></p>')
    from auth.users au join public.profiles p on p.id = au.id
    where au.id = r.id and p.email_alerts and au.email is not null;

    -- A guest reporter who chose "by email" for this specific report.
    perform private.send_email(private.dec(c.email_enc), p_title, '<p>' || p_body || '</p><p><a href="' || link || '">Open the report</a></p>')
    from public.issue_reporter_contacts c
    where c.issue_id = p_issue and c.user_id = r.id and c.email_alerts;
  end loop;
end;
$$;
