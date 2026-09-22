// Delivers a CivicPulse notification to a person's registered phones and browsers (Web Push).
// Called by the notifications_push database trigger through pg_net with only a notification id and
// a shared secret. Keys, devices and the message are fetched here with the service role, so the
// VAPID private key never travels in a request.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Job = {
  vapid: { publicKey: string; privateKey: string; subject: string };
  subscriptions: Subscription[];
  payload: { title: string; body: string; url: string; tag?: string };
} | null;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = req.headers.get('x-push-secret');
  let id: string | undefined;
  try { ({ id } = await req.json()); } catch { return new Response('Bad JSON', { status: 400 }); }
  if (!secret || !id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Missing fields', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // push_job checks the shared secret; a wrong secret is rejected by the database.
  const { data, error } = await admin.rpc('push_job', { p_id: id, p_secret: secret });
  if (error) return new Response('Forbidden', { status: 403 });
  const job = data as Job;
  if (!job || job.subscriptions.length === 0) return Response.json({ sent: 0 });

  webpush.setVapidDetails(job.vapid.subject, job.vapid.publicKey, job.vapid.privateKey);
  const targets = job.subscriptions.slice(0, 20);
  const results = await Promise.allSettled(
    targets.map((s) => webpush.sendNotification(s, JSON.stringify(job.payload), { TTL: 86_400, urgency: 'normal' })),
  );

  // The push service says these devices unsubscribed or expired; forget them.
  const gone = results
    .map((r, i) => (r.status === 'rejected' && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0) ? targets[i].endpoint : null))
    .filter((e): e is string => Boolean(e));
  for (const endpoint of gone) await admin.rpc('remove_push_endpoint', { p_endpoint: endpoint });

  return Response.json({ sent: results.filter((r) => r.status === 'fulfilled').length, removed: gone.length });
});
