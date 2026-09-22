-- Field-level encryption for contact details of reports made without an account.
-- Name, email and phone are stored encrypted (pgcrypto, AES via OpenPGP symmetric encryption) with a
-- data key held in Supabase Vault. Spam limits match on salted one-way hashes, so the plain values
-- are never needed for checks. Admins read details only through admin_reporter_contacts(), and every
-- read is written to the audit log.

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'contact_key', 'Encrypts guest reporter contact details')
where not exists (select 1 from vault.secrets where name = 'contact_key');

create or replace function private.contact_key()
returns text
language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'contact_key' $$;
revoke execute on function private.contact_key() from public, anon, authenticated;

create or replace function private.enc(p text)
returns bytea
language sql stable security definer set search_path = ''
as $$ select extensions.pgp_sym_encrypt(p, private.contact_key(), 'cipher-algo=aes256') $$;
create or replace function private.dec(p bytea)
returns text
language sql stable security definer set search_path = ''
as $$ select extensions.pgp_sym_decrypt(p, private.contact_key()) $$;
revoke execute on function private.enc(text), private.dec(bytea) from public, anon, authenticated;

-- The table is empty at this point (verified), so the plain columns can simply be replaced.
alter table public.issue_reporter_contacts
  drop column name, drop column email, drop column phone,
  add column name_enc bytea not null,
  add column email_enc bytea not null,
  add column phone_enc bytea not null,
  add column email_hash text not null,
  add column phone_hash text not null;
create index on public.issue_reporter_contacts (email_hash, created_at desc);
create index on public.issue_reporter_contacts (phone_hash, created_at desc);

-- Nobody reads the table directly any more, not even admins.
revoke all on public.issue_reporter_contacts from anon, authenticated;
drop policy if exists "admins read reporter contacts" on public.issue_reporter_contacts;

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

    insert into public.issue_reporter_contacts (issue_id, user_id, name_enc, email_enc, phone_enc, email_hash, phone_hash, device_hash, ip_hash)
    values (new.id, new.author_id, private.enc(v_name), private.enc(v_email), private.enc(v_phone), h_email, h_phone, v_device, v_ip);

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

-- Admin view of the contact for up to 50 reports at a time. Each call is audited.
create or replace function public.admin_reporter_contacts(p_issues uuid[])
returns table (issue_id uuid, name text, email text, phone text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if coalesce(array_length(p_issues, 1), 0) > 50 then raise exception 'At most 50 reports at a time'; end if;
  if exists (select 1 from public.issue_reporter_contacts c where c.issue_id = any (p_issues)) then
    perform public.log_admin('view_contact', 'issues', null,
      jsonb_build_object('issues', (select jsonb_agg(c.issue_id) from public.issue_reporter_contacts c where c.issue_id = any (p_issues))));
  end if;
  return query
  select c.issue_id, private.dec(c.name_enc), private.dec(c.email_enc), private.dec(c.phone_enc)
  from public.issue_reporter_contacts c where c.issue_id = any (p_issues);
end;
$$;
revoke execute on function public.admin_reporter_contacts(uuid[]) from public, anon;
grant execute on function public.admin_reporter_contacts(uuid[]) to authenticated;

-- Data export shows the person their own (decrypted) contact details.
create or replace function public.export_my_data()
returns json
language sql stable security definer set search_path = ''
as $$
  select json_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = (select auth.uid())),
    'private_details', (select to_jsonb(pp) - 'id' from public.profile_private pp where pp.id = (select auth.uid())),
    'email', (select email from auth.users where id = (select auth.uid())),
    'reports', coalesce((select json_agg(json_build_object('ref', ref_no, 'title', title, 'description', description, 'category', category,
        'status', status, 'location', location_text, 'lat', lat, 'lng', lng, 'anonymous', anonymous, 'confidential', confidential, 'created_at', created_at))
      from public.issues where author_id = (select auth.uid())), '[]'::json),
    'reporter_contact_details', coalesce((select json_agg(json_build_object('name', private.dec(name_enc), 'email', private.dec(email_enc),
        'phone', private.dec(phone_enc), 'created_at', created_at))
      from public.issue_reporter_contacts where user_id = (select auth.uid())), '[]'::json),
    'comments', coalesce((select json_agg(json_build_object('body', body, 'created_at', created_at)) from public.comments where author_id = (select auth.uid())), '[]'::json),
    'event_rsvps', coalesce((select json_agg(json_build_object('event', e.title, 'with_children', r.with_children, 'children_count', r.children_count))
      from public.event_rsvps r join public.events e on e.id = r.event_id where r.user_id = (select auth.uid())), '[]'::json),
    'emergency_contacts', coalesce((select json_agg(json_build_object('name', name, 'phone', phone)) from public.emergency_contacts where user_id = (select auth.uid())), '[]'::json),
    'points', coalesce((select json_agg(json_build_object('delta', delta, 'reason', reason, 'at', created_at)) from public.points_ledger where user_id = (select auth.uid())), '[]'::json),
    'verification_requests', coalesce((select json_agg(json_build_object('document', doc_type, 'status', status, 'created_at', created_at))
      from public.verification_requests where user_id = (select auth.uid())), '[]'::json)
  );
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
