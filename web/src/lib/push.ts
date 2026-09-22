import { supabase } from './supabase';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// Asks permission, subscribes this browser and saves the subscription for the signed-in user.
export async function enablePush(userId: string): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive notifications. On iPhone, add CivicPulse to your Home Screen first.');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Notifications work in the installed or published app, not in this preview.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings to turn them on.');
  const { data: key, error } = await supabase.rpc('push_public_key');
  if (error || !key) throw new Error('Notifications are not set up on the server yet.');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key as string) });
  const json = sub.toJSON();
  const { error: saveError } = await supabase.from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: json.endpoint!, p256dh: json.keys!.p256dh, auth: json.keys!.auth }, { onConflict: 'endpoint', ignoreDuplicates: true });
  if (saveError) throw new Error(saveError.message);
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
