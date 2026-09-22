-- Push hardening: the database no longer sends the VAPID private key over the network.
-- The trigger posts only the notification id plus a shared secret. The send-push function then
-- asks push_job() for the keys, subscriptions and message, using the service role, which only
-- the Supabase functions runtime holds.

insert into private.app_secrets (key, value)
values ('push_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.push_job(p_id uuid, p_secret text)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  n public.notifications;
begin
  if p_secret is null or p_secret is distinct from (select value from private.app_secrets where key = 'push_secret') then
    raise exception 'forbidden';
  end if;
  select * into n from public.notifications where id = p_id;
  if n.id is null then return null; end if;
  return json_build_object(
    'vapid', json_build_object(
      'publicKey', (select value from private.app_secrets where key = 'vapid_public'),
      'privateKey', (select value from private.app_secrets where key = 'vapid_private'),
      'subject', 'mailto:alerts@civicpulse.invalid'),
    'subscriptions', coalesce((select json_agg(json_build_object('endpoint', s.endpoint, 'keys', json_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      from public.push_subscriptions s where s.user_id = n.user_id), '[]'::json),
    'payload', json_build_object('title', n.title, 'body', coalesce(n.body, ''),
      'url', case when n.issue_id is not null then '/issues/' || n.issue_id else '/' end, 'tag', n.kind));
end;
$$;
revoke execute on function public.push_job(uuid, text) from public, anon, authenticated;
grant execute on function public.push_job(uuid, text) to service_role;

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  secret text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  select value into secret from private.app_secrets where key = 'push_secret';
  if secret is null then return new; end if;
  perform net.http_post(
    url := 'https://cqjeknyjzhtmdfempdvq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 5000);
  return new;
end;
$$;
revoke execute on function public.push_notification() from public, anon, authenticated;
