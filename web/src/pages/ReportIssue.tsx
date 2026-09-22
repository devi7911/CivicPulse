import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Captcha, captchaEnabled } from '../components/Captcha';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowBigUp, BellRing, Camera, EyeOff, Globe, Lock, MapPinned, ScanFace, Trash2, UserRound, Video, WifiOff } from 'lucide-react';
import { LocationPicker } from '../components/IssueMap';
import { PhotoEditor } from '../components/PhotoEditor';
import { useAuth } from '../hooks/useAuth';
import { useLocation2 } from '../hooks/useLocation';
import { useT } from '../lib/i18n';
import { ISSUE_CATEGORIES, QUICK_DETAILS, STATUS_LABEL } from '../lib/constants';
import { isOffline, queueReport } from '../lib/offline';
import { DuplicateReportError, submitReport } from '../lib/report';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_TYPES, videoDuration } from '../lib/geo';
import { supabase } from '../lib/supabase';
import type { IssueCategory, NearbyIssue } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';
import { validIndianMobile } from '../lib/accounts';

type LatLng = { lat: number; lng: number };
type GuestDetails = { name: string; email: string; phone: string };
type Visibility = 'public' | 'anonymous' | 'confidential';
type Photo = { id: string; blob: Blob; url: string; edited: boolean };

const MAX_PHOTOS = 3;
const DETAILS_KEY = 'civicpulse:guest-details';
const DEVICE_KEY = 'civicpulse:device-id';

// One choice instead of separate "anonymous" and "confidential" checkboxes.
const VISIBILITY: { key: Visibility; label: string; icon: typeof Globe; hint: string }[] = [
  { key: 'public', label: 'Public', icon: Globe, hint: 'Everyone can see the report and your name.' },
  { key: 'anonymous', label: 'Anonymous', icon: EyeOff, hint: 'Everyone can see the report, but not your name. Admins can still see who reported it, to stop abuse.' },
  { key: 'confidential', label: 'Confidential', icon: Lock, hint: 'Hidden from the public feed and map. Only you and CivicPulse admins can see it.' },
];

// A random ID kept in this browser. Browsers do not expose hardware IDs or MAC addresses, so this,
// together with email, phone and network, is what the server uses to limit reports without an account.
function deviceId(): string | null {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return null; }
}

function loadDetails(): GuestDetails {
  try { return { name: '', email: '', phone: '', ...JSON.parse(localStorage.getItem(DETAILS_KEY) ?? '{}') }; } catch { return { name: '', email: '', phone: '' }; }
}

// Reads the GPS position stored in a photo, if any, before the upload strips it.
async function photoLocation(file: Blob): Promise<LatLng | null> {
  try {
    const { gps } = await import('exifr');
    const g = await gps(file);
    return g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude) ? { lat: g.latitude, lng: g.longitude } : null;
  } catch {
    return null;
  }
}

export function ReportIssue() {
  const { userId, isGuest, refreshProfile } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory>('roads');
  const [details, setDetails] = useState<string[]>([]);
  const [locationText, setLocationText] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  // Start the pin at the person's shared location; a photo's GPS or a tap on the map replaces it.
  const { centre } = useLocation2();
  useEffect(() => {
    if (centre?.source === 'device') setCoords((c) => c ?? { lat: centre.lat, lng: centre.lng });
  }, [centre]);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [video, setVideo] = useState<{ blob: Blob; url: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  async function pickVideo(file: File | null) {
    setVideoError(null);
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) { setVideoError('Please choose an MP4, WebM or MOV video.'); return; }
    if (file.size > MAX_VIDEO_BYTES) { setVideoError('The video must be 25 MB or smaller. Record a shorter clip.'); return; }
    try {
      const secs = await videoDuration(file);
      if (secs > MAX_VIDEO_SECONDS + 0.5) { setVideoError(`The video is ${Math.round(secs)} seconds. Please keep it to ${MAX_VIDEO_SECONDS} seconds or less.`); return; }
    } catch (e) { setVideoError((e as Error).message); return; }
    setVideo({ blob: file, url: URL.createObjectURL(file) });
  }
  const [editing, setEditing] = useState<Photo | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const anonymous = visibility === 'anonymous';
  const confidential = visibility === 'confidential';
  // Only asked of people without an account. Ticked: a guest session on this device keeps the report
  // linked to them, so they get updates and can confirm the fix. Unticked: filed and forgotten.
  const [track, setTrack] = useState(false);
  const [guest, setGuest] = useState<GuestDetails>(loadDetails);
  const signedOut = !userId;
  const [captchaOk, setCaptchaOk] = useState(false);
  const onCaptcha = useCallback((t: string | null) => setCaptchaOk(Boolean(t)), []);
  const canInteract = Boolean(userId) && !isGuest;
  const tracking = !signedOut || track || confidential;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [dupe, setDupe] = useState<DuplicateReportError | null>(null);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDetails([]); }, [category]);

  // Open reports of the same kind within a short walk, so people can back one instead of duplicating it.
  const nearby = useQuery({
    queryKey: ['nearby', category, coords?.lat.toFixed(4), coords?.lng.toFixed(4)],
    enabled: Boolean(coords) && !isOffline(),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('nearby_open_issues', { p_lat: coords!.lat, p_lng: coords!.lng, p_category: category, p_radius_m: 250 });
      if (error) throw new Error(error.message);
      return data as NearbyIssue[];
    },
  });

  const backIt = useMutation({
    mutationFn: async (issueId: string) => {
      const { error } = await supabase.from('issue_upvotes').insert({ issue_id: issueId, user_id: userId! });
      if (error && !error.message.includes('duplicate')) throw new Error(error.message);
      await supabase.from('issue_follows').insert({ issue_id: issueId, user_id: userId! });
      return issueId;
    },
    onSuccess: (issueId) => { qc.invalidateQueries({ queryKey: ['issues'] }); navigate(`/issues/${issueId}`); },
    onError: (e: Error) => setError(e.message),
  });

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room);
    if (picked.length === 0) return;
    setPhotos((cur) => [...cur, ...picked.map((f) => ({ id: crypto.randomUUID(), blob: f as Blob, url: URL.createObjectURL(f), edited: false }))]);
    if (!coords) {
      const loc = await photoLocation(picked[0]);
      if (loc) { setCoords(loc); setFromPhoto(true); }
    }
  }

  function removePhoto(id: string) {
    setPhotos((cur) => { const p = cur.find((x) => x.id === id); if (p) URL.revokeObjectURL(p.url); return cur.filter((x) => x.id !== id); });
  }

  function saveEdit(blob: Blob) {
    if (!editing) return;
    setPhotos((cur) => cur.map((p) => {
      if (p.id !== editing.id) return p;
      URL.revokeObjectURL(p.url);
      return { ...p, blob, url: URL.createObjectURL(blob), edited: true };
    }));
    setEditing(null);
  }

  function toggleDetail(d: string) {
    setDetails((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
    if (!title.trim()) setTitle(d);
  }

  const fields = useMemo(() => {
    const detailLine = details.length ? `Details: ${details.join(', ')}.\n` : '';
    return {
      title: title.trim(),
      description: (detailLine + description.trim()).trim(),
      category,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      location_text: locationText.trim(),
      anonymous: anonymous || confidential,
      confidential,
      // Only for reports without an account. The server moves these into a private, admin-only
      // table, checks the 3-per-30-days limit, and never stores them on the public report.
      ...(canInteract ? {} : { guest_name: guest.name.trim(), guest_email: guest.email.trim(), guest_phone: guest.phone.trim(), device_id: deviceId() }),
    };
  }, [title, description, details, category, coords, locationText, anonymous, confidential, canInteract, guest]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await send(false);
  }

  // `distinct` is the reporter confirming theirs differs from an existing report the server matched.
  async function send(distinct: boolean) {
    if (!canInteract && !validIndianMobile(guest.phone)) { setError('Please enter a valid 10-digit Indian mobile number.'); return; }
    setBusy(true);
    setError(null);
    setDupe(null);
    if (!canInteract) { try { localStorage.setItem(DETAILS_KEY, JSON.stringify(guest)); } catch { /* private mode */ } }

    // No connection: keep the report on this device and send it when the connection returns.
    if (isOffline()) {
      try {
        await queueReport({ id: crypto.randomUUID(), createdAt: Date.now(), fields, photos: photos.map((p) => p.blob), video: video?.blob ?? null, tracking });
        setQueued(true);
      } catch {
        setError('You are offline and this report could not be saved on the device. Please try again when connected.');
      }
      setBusy(false);
      return;
    }

    try {
      const id = await submitReport({ fields: distinct ? { ...fields, confirmed_distinct: true } : fields, photos: photos.map((p) => p.blob), video: video?.blob ?? null, tracking, signedOut });
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['issue-stats'] });
      refreshProfile();
      navigate(`/issues/${id}`, { replace: true, state: { justReported: true, tracked: tracking } });
    } catch (err) {
      if (err instanceof DuplicateReportError) setDupe(err);
      else setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const matches = nearby.data ?? [];
  const descOk = (details.length > 0 ? 10 : 0) + description.trim().length >= 10;

  if (queued) {
    return (
      <div className="card mx-auto max-w-lg space-y-3 p-6 text-center">
        <WifiOff className="mx-auto text-primary" size={34} />
        <h1 className="text-xl font-bold">Saved on this device</h1>
        <p className="text-sm text-muted">You are offline. Your report and photos are saved and will be sent automatically as soon as you are back online. You will then get its reference number.</p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stagger card mx-auto max-w-2xl space-y-5 p-5 sm:p-8">
      <div>
        <p className="label">New report</p>
        <h1 className="page-title">{t('report.title')}</h1>
        <p className="mt-1 text-xs text-muted">
          CivicPulse is a community platform, not an official GHMC channel. You will get a reference number to track your report here.
        </p>
        {(!userId || isGuest) && (
          <p className="mt-3 rounded-xl bg-primary-soft p-3 text-xs text-primary">
            <span className="font-bold">No account needed to report.</span> To back, comment on or follow reports,{' '}
            <Link to="/auth" state={{ from: '/report' }} className="font-bold underline">create an account or sign in</Link>.
          </p>
        )}
        {isOffline() && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-sand p-3 text-xs"><WifiOff size={14} /> You are offline. You can still fill this in; it will be sent when you reconnect.</p>
        )}
      </div>

      <div>
        <label htmlFor="category" className="label">Category</label>
        <select id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
          {(Object.keys(ISSUE_CATEGORIES) as IssueCategory[]).map((c) => <option key={c} value={c}>{ISSUE_CATEGORIES[c]}</option>)}
        </select>
      </div>

      <fieldset>
        <legend className="label">What do you see? Tap all that apply</legend>
        <div className="flex flex-wrap gap-2">
          {QUICK_DETAILS[category].map((d) => (
            <button key={d} type="button" aria-pressed={details.includes(d)} onClick={() => toggleDetail(d)} className={`chip ${details.includes(d) ? 'chip-on' : ''}`}>{d}</button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="title" className="label">Short title</label>
        <input id="title" className="input" required minLength={5} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deep pothole near the bus stop" />
      </div>

      <div>
        <label htmlFor="description" className="label">More details {details.length > 0 && <span className="font-normal">(optional)</span>}</label>
        <textarea id="description" className="input" rows={3} maxLength={1800} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="How big is it, how long has it been there, who is affected?" />
        {!descOk && description.length > 0 && <p className="mt-1 text-[11px] text-muted">Add a little more detail, or tap one of the options above.</p>}
      </div>

      <div>
        <span className="label">Photos (up to {MAX_PHOTOS}, recommended)</span>
        {photos.length > 0 && (
          <ul className="mb-2 grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-card">
                <img src={p.url} alt="Selected" className="aspect-square w-full object-cover" />
                <div className="flex">
                  <button type="button" onClick={() => setEditing(p)} className="flex min-h-9 flex-1 items-center justify-center gap-1 text-[11px] font-semibold text-primary hover:bg-sand">
                    <ScanFace size={13} /> {p.edited ? 'Blurred' : 'Blur'}
                  </button>
                  <button type="button" onClick={() => removePhoto(p.id)} aria-label="Remove photo" className="flex min-h-9 w-9 items-center justify-center text-muted hover:bg-blush hover:text-brick"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_PHOTOS && (
          <label className="btn btn-ghost w-full cursor-pointer">
            <Camera size={16} /> {photos.length ? 'Add another photo' : 'Take or choose photos'}
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only"
              onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
          </label>
        )}
        <p className="mt-1 text-[11px] text-muted">Use "Blur" to hide faces and number plates. Hidden location data in photos is removed before upload.</p>
      </div>

      <div>
        <span className="label">Short video (optional, up to {MAX_VIDEO_SECONDS} seconds)</span>
        {video ? (
          <div className="space-y-2">
            <video src={video.url} controls playsInline className="max-h-64 w-full rounded-xl bg-ink" />
            <button type="button" onClick={() => { URL.revokeObjectURL(video.url); setVideo(null); }} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-brick"><Trash2 size={13} /> Remove video</button>
          </div>
        ) : (
          <label className="btn btn-ghost w-full cursor-pointer">
            <Video size={16} /> Record or choose a video
            <input type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" className="sr-only"
              onChange={(e) => { void pickVideo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
        )}
        {videoError && <p className="mt-1 text-xs font-semibold text-brick">{videoError}</p>}
        <p className="mt-1 text-[11px] text-muted">Useful for flooding, leaks or noise. Videos are not blurred, so avoid filming people's faces and number plates.</p>
      </div>

      <div>
        <span className="label flex items-center gap-1.5"><MapPinned size={14} /> Where is it?</span>
        <LocationPicker value={coords} onChange={(v) => { setCoords(v); setFromPhoto(false); }} />
        {fromPhoto && <p className="mt-1 text-xs font-semibold text-leaf">Location taken from your photo. Check the pin is right.</p>}
        <input id="location" aria-label="Street, landmark or area" className="input mt-2" required minLength={3} maxLength={200} value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Street, landmark, area" />
      </div>

      {matches.length > 0 && (
        <section aria-labelledby="dupe-h" className="rounded-xl border border-gold-line bg-gold-soft p-4">
          <h2 id="dupe-h" className="text-sm font-bold">Already reported nearby?</h2>
          <p className="mt-0.5 text-xs text-muted">
            {canInteract ? 'Backing an existing report adds weight to it and you will be notified when it changes.'
              : <>If it is the same problem, <Link to="/auth" state={{ from: '/report' }} className="font-semibold text-primary underline">sign in or create an account</Link> to back it instead of reporting again.</>}
          </p>
          <ul className="mt-3 space-y-2">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-lg bg-card p-2.5">
                <span className="min-w-0 flex-1">
                  <Link to={`/issues/${m.id}`} className="block truncate text-sm font-semibold hover:text-primary">{m.title}</Link>
                  <span className="block text-[11px] text-muted">{m.ref_no} · {STATUS_LABEL[m.status]} · {m.distance_m} m away · {m.upvote_count} backing</span>
                </span>
                {canInteract ? (
                  <button type="button" className="btn btn-primary min-h-9 shrink-0 px-3 text-xs" disabled={backIt.isPending} onClick={() => backIt.mutate(m.id)}>
                    <ArrowBigUp size={15} /> Back this
                  </button>
                ) : (
                  <Link to={`/issues/${m.id}`} className="btn btn-ghost min-h-9 shrink-0 px-3 text-xs">View</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canInteract && (
        <fieldset className="space-y-2 rounded-xl border border-line p-4">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-bold"><UserRound size={15} /> Your details</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="input" required minLength={2} maxLength={60} autoComplete="name" aria-label="Your name" placeholder="Your name"
              value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
            <input className="input" type="email" required maxLength={120} autoComplete="email" aria-label="Email" placeholder="Email"
              value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            <input className="input" type="tel" inputMode="numeric" required maxLength={16} autoComplete="tel-national" aria-label="Mobile number" placeholder="10-digit mobile"
              value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
          </div>
          <p className="text-xs text-muted">Private: only CivicPulse admins see these. Without an account you can file 3 reports every 30 days.</p>
        </fieldset>
      )}

      <fieldset>
        <legend className="label">Who can see this report?</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-xl bg-sand p-1">
          {VISIBILITY.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" role="radio" aria-checked={visibility === key} onClick={() => setVisibility(key)}
              className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition sm:text-sm ${visibility === key ? 'bg-card text-primary shadow-sm' : 'text-muted hover:text-ink'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">{VISIBILITY.find((v) => v.key === visibility)!.hint}</p>
      </fieldset>

      {signedOut && (
        <label className={`flex items-start gap-3 rounded-xl border p-4 ${tracking ? 'border-primary bg-primary-soft/60' : 'border-line'}`}>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={tracking} disabled={confidential} onChange={(e) => setTrack(e.target.checked)} />
          <span className="text-sm">
            <span className="flex items-center gap-1.5 font-semibold"><BellRing size={15} /> Track this report on this device</span>
            <span className="block text-xs text-muted">
              {confidential ? 'Confidential reports are always tracked, so you can see yours again.' : 'Get updates here and confirm when it is fixed. If unticked, keep the reference number to look it up later.'}
            </span>
          </span>
        </label>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}

      {dupe && (
        <section role="alert" className="space-y-3 rounded-xl border border-gold-line bg-gold-soft p-4">
          {dupe.own ? (
            <>
              <h2 className="text-sm font-bold">You have already reported this</h2>
              <p className="text-sm">Your report <b>{dupe.ref}</b> for this spot is still open and being tracked. Reporting it again will not speed it up.</p>
              <Link to={`/issues/${dupe.issueId}`} className="btn btn-primary w-full">Open my report {dupe.ref}</Link>
            </>
          ) : (
            <>
              <h2 className="text-sm font-bold">This has already been reported</h2>
              <p className="text-sm">
                <b>{dupe.ref}</b> is an open report of the same kind right here. Backing it adds weight and you will get its updates.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {canInteract
                  ? <button type="button" className="btn btn-primary flex-1" disabled={backIt.isPending} onClick={() => backIt.mutate(dupe.issueId)}><ArrowBigUp size={16} /> Back {dupe.ref} instead</button>
                  : <Link to={`/issues/${dupe.issueId}`} className="btn btn-primary flex-1">View {dupe.ref}</Link>}
                <button type="button" className="btn btn-ghost flex-1" disabled={busy} onClick={() => void send(true)}>It is a different problem, send mine</button>
              </div>
              <p className="text-[11px] text-muted">Only choose “different problem” if it really is. Admins merge reports that turn out to be the same.</p>
            </>
          )}
        </section>
      )}

      {!canInteract && (
        <p className="text-[11px] leading-snug text-muted">
          By submitting, you agree that CivicPulse keeps your name, email and phone privately to contact you about this report and to prevent spam.
        </p>
      )}
      <p className="text-[11px] text-muted">By submitting you accept the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.</p>
      {signedOut && captchaEnabled && <Captcha onToken={onCaptcha} />}
      <button type="submit" className="btn btn-primary w-full text-base" disabled={busy || !descOk || (signedOut && captchaEnabled && !captchaOk)}>{busy ? t('report.submitting') : t('report.submit')}</button>

      <PhotoEditor file={editing?.blob ?? null} open={Boolean(editing)} onClose={() => setEditing(null)} onSave={saveEdit} />
    </form>
  );
}
