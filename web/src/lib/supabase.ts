import { createClient } from '@supabase/supabase-js';
import { captchaEnabled, clearCaptchaToken, getCaptchaToken } from '../components/Captcha';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

// A placeholder keeps imports safe when env vars are missing; App shows a setup screen instead.
export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder');

export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  // Sample reports point at free-licence photos shipped with the app (web/public/samples).
  if (path.startsWith('samples/')) return `/${path}`;
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// Re-encoding through a canvas shrinks the file and drops EXIF data, including GPS.
async function reencode(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85),
  );
}

export async function uploadPhoto(userId: string, file: Blob, bucket: 'photos' | 'id-docs' = 'photos'): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
  if (file.size > MAX_BYTES * 2) throw new Error('That image is too large (10 MB max).');
  const blob = await reencode(file);
  if (blob.size > MAX_BYTES) throw new Error('That image is too large after processing.');
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return path;
}

// ID documents sit in a private bucket. A short-lived signed link is the only way to view one.
export async function signedDocUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('id-docs').createSignedUrl(path, 120);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Sponsored media lives in its own public bucket.
export function adMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('ads').getPublicUrl(path).data.publicUrl;
}

const AD_TYPES = ['image/gif', 'image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm'];

// Admins upload house-ad media to the bucket root; advertisers must use their own folder (enforced by storage rules).
export async function uploadAdMedia(file: File, folder?: string): Promise<{ path: string; type: 'image' | 'gif' | 'video' }> {
  if (!AD_TYPES.includes(file.type)) throw new Error('Please choose a GIF, MP4, WebM, JPG, PNG or WebP file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Ad media must be 8 MB or smaller.');
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${folder ? `${folder}/` : ''}${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('ads').upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return { path, type: file.type.startsWith('video/') ? 'video' : file.type === 'image/gif' ? 'gif' : 'image' };
}

// Reporting should not require an account. If nobody is signed in, start a guest session (Supabase
// anonymous sign-in). The guest can add an email later and keep everything they reported.
export async function ensureSignedIn(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const captchaToken = getCaptchaToken();
  // TypeError keeps offline-queued reports waiting until a security check has been solved.
  if (captchaEnabled && !captchaToken) throw new TypeError('Please complete the security check first.');
  const { data: guest, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  clearCaptchaToken();
  if (error || !guest.user) {
    const off = error?.message.toLowerCase().includes('disabled');
    throw new Error(off ? 'Reporting without an account is switched off right now. Please sign in to report.' : error?.message ?? 'Could not start a guest session.');
  }
  return guest.user.id;
}
