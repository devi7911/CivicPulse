-- Encrypt the masked-Aadhaar last-4-digits at rest, the same way reporter contact details already
-- are. The plaintext column stays only as the insert channel; a trigger moves the value into
-- encrypted storage and blanks the plaintext before the row is ever written to disk.
alter table public.verification_requests add column if not exists aadhaar_last4_enc bytea;

-- Move any existing plaintext values into encrypted storage.
update public.verification_requests
set aadhaar_last4_enc = private.enc(aadhaar_last4)
where aadhaar_last4 is not null and aadhaar_last4_enc is null;

alter table public.verification_requests drop constraint if exists masked_aadhaar_needs_last4;
alter table public.verification_requests add constraint masked_aadhaar_needs_last4
  check (doc_type <> 'masked_aadhaar' or aadhaar_last4_enc is not null);

create or replace function public.verification_encrypt_aadhaar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.aadhaar_last4 is not null then
    new.aadhaar_last4_enc := private.enc(new.aadhaar_last4);
  end if;
  new.aadhaar_last4 := null;
  return new;
end;
$$;

drop trigger if exists verification_0_encrypt_aadhaar on public.verification_requests;
create trigger verification_0_encrypt_aadhaar before insert on public.verification_requests
  for each row execute function public.verification_encrypt_aadhaar();

-- The plaintext column is now write-only (always null once stored); no one needs to read it.
revoke select (aadhaar_last4) on public.verification_requests from authenticated;

-- Admins decrypt one request's last 4 digits on demand, matching the review card. Every look is audited.
create or replace function public.admin_aadhaar_last4(p_request uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v bytea;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select aadhaar_last4_enc into v from public.verification_requests where id = p_request;
  if v is null then return null; end if;
  perform public.log_admin('view_contact', 'verification_requests', p_request::text, '{}'::jsonb);
  return private.dec(v);
end;
$$;
revoke all on function public.admin_aadhaar_last4(uuid) from public, anon;
grant execute on function public.admin_aadhaar_last4(uuid) to authenticated;
