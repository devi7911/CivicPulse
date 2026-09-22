import { ensureSignedIn, supabase, uploadPhoto } from './supabase';
import { queuedReports, removeQueued, type QueuedReport } from './offline';
import { areaFor, MAX_VIDEO_BYTES, VIDEO_TYPES } from './geo';

export interface ReportInput {
  fields: Record<string, unknown>; // issue columns except author_id and photo_path
  photos: Blob[]; // first is the main photo, the rest become extra photos
  video?: Blob | null; // optional short clip
  tracking: boolean; // signed-out reporter asked to track it on this device
  signedOut: boolean; // nobody was signed in when the report was made
}

async function uploadVideo(uid: string, file: Blob): Promise<string> {
  if (!VIDEO_TYPES.includes(file.type)) throw new Error('Please choose an MP4, WebM or MOV video.');
  if (file.size > MAX_VIDEO_BYTES) throw new Error('The video must be 25 MB or smaller.');
  const ext = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('videos').upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

export const videoUrl = (p: string | null | undefined) => (p ? supabase.storage.from('videos').getPublicUrl(p).data.publicUrl : null);

// The server refuses a report that repeats an open one at the same spot. `own` means the same person
// already reported it; otherwise someone else did, and the reporter may confirm theirs is different.
export class DuplicateReportError extends Error {
  constructor(public own: boolean, public ref: string, public issueId: string) {
    super(own ? `You have already reported this problem (${ref}).` : `This problem has already been reported (${ref}).`);
  }
}

function duplicateFrom(message: string): DuplicateReportError | null {
  const m = /DUPLICATE(_OWN)?:([^:]+):([0-9a-f-]{36})/.exec(message);
  return m ? new DuplicateReportError(Boolean(m[1]), m[2], m[3]) : null;
}

// Files a report. Used by the form and by the offline outbox, so both behave the same.
export async function submitReport({ fields, photos, video, tracking, signedOut }: ReportInput): Promise<string> {
  const uid = await ensureSignedIn();
  const paths: string[] = [];
  for (const p of photos.slice(0, 3)) paths.push(await uploadPhoto(uid, p));
  let vpath: string | null = null;
  try {
    if (video) vpath = await uploadVideo(uid, video);
  } catch (e) {
    if (paths.length) await supabase.storage.from('photos').remove(paths);
    throw e;
  }
  const area = typeof fields.lat === 'number' && typeof fields.lng === 'number' ? await areaFor(fields.lat, fields.lng) : null;

  const { data, error } = await supabase.from('issues')
    .insert({ ...fields, author_id: uid, photo_path: paths[0] ?? null, video_path: vpath, area })
    .select('id').single();
  if (error) {
    if (paths.length) await supabase.storage.from('photos').remove(paths);
    if (vpath) await supabase.storage.from('videos').remove([vpath]);
    throw duplicateFrom(error.message) ?? new Error(error.message);
  }
  if (paths.length > 1) {
    await supabase.from('issue_photos').insert(paths.slice(1).map((path) => ({ issue_id: data.id, user_id: uid, path })));
  }
  // Not tracking: the guest session was only needed to file the report.
  if (signedOut && !tracking) await supabase.auth.signOut({ scope: 'local' });
  return data.id as string;
}

let flushing = false;

// Sends reports saved while offline. Returns how many were sent.
export async function flushOutbox(onSent?: (issueId: string, q: QueuedReport) => void): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const q of await queuedReports()) {
      try {
        const { data } = await supabase.auth.getSession();
        const id = await submitReport({ fields: q.fields, photos: q.photos, video: q.video ?? null, tracking: q.tracking, signedOut: !data.session });
        await removeQueued(q.id);
        sent += 1;
        onSent?.(id, q);
      } catch (e) {
        // A rule rejection (limit reached, invalid details) will never succeed; drop it instead of retrying forever.
        if (!(e instanceof TypeError)) await removeQueued(q.id);
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
