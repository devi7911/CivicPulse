-- Test accounts for local testing. Run once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/cqjeknyjzhtmdfempdvq/sql/new
-- Change the password below first. Every account uses the same one.
-- Emails use the reserved .test domain, so no mail is ever sent to them.
-- To remove them later:  delete from auth.users where email like '%@civicpulse.test';

do $$
declare
  pw text := 'Test@12345';   -- <- change me
  acc record;
  uid uuid;
begin
  for acc in
    select * from (values
      ('admin@civicpulse.test',   'Test Admin',        'individual', null,                             '9000000001', 'admin',   true),
      ('admin2@civicpulse.test',  'Test Admin Two',    'individual', null,                             '9000000002', 'admin',   true),
      ('ngo@civicpulse.test',     'Test NGO Lead',     'ngo',        'Test Helping Hands',             '9000000003', 'citizen', true),
      ('gov@civicpulse.test',     'Test Ward Officer', 'government', 'Test GHMC Circle Office',        '9000000004', 'citizen', true),
      ('citizen@civicpulse.test', 'Test Citizen',      'individual', null,                             '9000000005', 'citizen', false)
    ) as t(email, name, account_type, org_name, phone, role, verified)
  loop
    if exists (select 1 from auth.users where email = acc.email) then
      raise notice 'Skipped % (already exists)', acc.email;
      continue;
    end if;
    uid := gen_random_uuid();

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      -- Supabase sign-in fails if these are NULL, so they are set to empty text.
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', acc.email,
      extensions.crypt(pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('display_name', acc.name, 'phone', acc.phone, 'address', 'Test address, Hyderabad',
                         'account_type', acc.account_type, 'org_name', acc.org_name),
      now(), now(), '', '', '', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', acc.email, 'email_verified', true), 'email', now(), now(), now());

    -- The sign-up trigger creates the profile from the details above; set role and badge.
    update public.profiles set role = acc.role::public.user_role, verified = acc.verified where id = uid;
    raise notice 'Created % (%)', acc.email, acc.role;
  end loop;
end $$;

select p.display_name, u.email, p.role, p.account_type, p.org_name, p.verified
from auth.users u join public.profiles p on p.id = u.id
where u.email like '%@civicpulse.test' order by u.email;
