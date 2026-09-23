import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Eye, Phone, Share2, Siren } from 'lucide-react';
import { Modal } from './Modal';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { friendlyError } from '../lib/friendlyError';

export interface ChildAlert {
  id: string; first_name: string; age: number | null; gender: 'girl' | 'boy' | 'other' | null; description: string | null;
  photo_path: string | null; last_seen_at: string; last_seen_place: string; police_station: string; police_phone: string; expires_at: string;
}

export const alertPhotoUrl = (p: string | null) => (p ? supabase.storage.from('alerts').getPublicUrl(p).data.publicUrl : null);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const tel = (n: string) => `tel:${n.replace(/[^+0-9]/g, '')}`;

// Missing-child alerts appear on every page, above everything else, until they close.
export function AmberAlerts() {
  const alerts = useQuery({
    queryKey: ['child-alerts'],
    refetchInterval: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('child_alerts')
        .select('id, first_name, age, gender, description, photo_path, last_seen_at, last_seen_place, police_station, police_phone, expires_at')
        .order('created_at', { ascending: false }).limit(3);
      if (error) throw new Error(error.message);
      return data as ChildAlert[];
    },
  });
  if (!alerts.data?.length) return null;
  return <div className="space-y-2">{alerts.data.map((a) => <AlertCard key={a.id} a={a} />)}</div>;
}

function AlertCard({ a }: { a: ChildAlert }) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(() => { try { return sessionStorage.getItem(`amber:${a.id}`) === 'min'; } catch { return false; } });
  const [sighting, setSighting] = useState(false);
  const photo = alertPhotoUrl(a.photo_path);
  const who = `${a.first_name}${a.age != null ? `, ${a.age} years` : ''}${a.gender ? `, ${a.gender}` : ''}`;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { sessionStorage.setItem(`amber:${a.id}`, next ? 'min' : 'open'); } catch { /* private mode */ }
  }

  async function share() {
    const text = `MISSING CHILD: ${who}. Last seen ${a.last_seen_place}, ${when(a.last_seen_at)}. If seen, call 112 or ${a.police_station} ${a.police_phone}.`;
    try {
      if (navigator.share) await navigator.share({ title: 'Missing child alert', text, url: window.location.origin });
      else { await navigator.clipboard.writeText(`${text} ${window.location.origin}`); window.alert('Alert copied. Paste it into WhatsApp or SMS.'); }
    } catch { /* cancelled */ }
  }

  return (
    <section role="alert" aria-label={`Missing child alert: ${who}`} className="overflow-hidden rounded-2xl border-2 border-red-600 bg-red-50 text-ink shadow-md">
      <button type="button" onClick={toggle} className="flex w-full items-start gap-2 bg-red-600 px-4 py-2 text-left text-sm font-bold text-white">
        <Siren size={18} className="mt-0.5 shrink-0 animate-pulse" />
        <span className="line-clamp-2 min-w-0 flex-1 py-0.5">{t('amber.missing')} · {who} · {a.last_seen_place}</span>
        {collapsed ? <ChevronDown size={18} className="mt-0.5 shrink-0" /> : <ChevronUp size={18} className="mt-0.5 shrink-0" />}
      </button>
      {!collapsed && (
        <div className={`grid gap-4 p-4 ${photo ? 'sm:grid-cols-[8rem_minmax(0,1fr)]' : ''}`}>
          {photo && <img src={photo} alt={`Photo of ${a.first_name}`} className="aspect-[3/4] w-32 rounded-xl border border-red-200 object-cover" />}
          <div className="min-w-0 space-y-2 text-sm">
            <p className="text-lg font-bold">{who}</p>
            <p><b>{t('amber.lastSeen')}:</b> {a.last_seen_place}, {when(a.last_seen_at)} IST</p>
            {a.description && <p><b>Description:</b> {a.description}</p>}
            <p className="text-xs text-muted">{a.police_station}. {t('amber.dontApproach')}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a href="tel:112" className="btn min-h-10 bg-red-600 px-4 text-white hover:bg-red-700"><Phone size={15} /> {t('amber.call112')}</a>
              <a href={tel(a.police_phone)} className="btn btn-ghost min-h-10 px-4"><Phone size={15} /> {a.police_station}</a>
              <button type="button" onClick={() => setSighting(true)} className="btn btn-ghost min-h-10 px-4"><Eye size={15} /> {t('amber.seen')}</button>
              <button type="button" onClick={share} className="btn btn-ghost min-h-10 px-4"><Share2 size={15} /> {t('amber.share')}</button>
            </div>
            <p className="text-[11px] text-muted">Childline: <a href="tel:1098" className="font-semibold underline">1098</a>. This alert was issued at the request of the police and ends {when(a.expires_at)}.</p>
          </div>
        </div>
      )}
      <SightingForm alert={a} open={sighting} onClose={() => setSighting(false)} />
    </section>
  );
}

function SightingForm({ alert, open, onClose }: { alert: ChildAlert; open: boolean; onClose: () => void }) {
  const [place, setPlace] = useState('');
  const [time, setTime] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('child_alert_sightings').insert({
        alert_id: alert.id, seen_at: new Date(time).toISOString(), place: place.trim(), note: note.trim(),
        contact_phone: phone.trim(), reporter_name: name.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null,
      });
      if (error) {
        const m = error.message;
        throw new Error(m.includes('contact_phone') ? 'Please enter a valid phone number (at least 8 digits).'
          : m.includes('reporter_name') ? 'Please enter your name.'
          : m.includes('note') ? 'Please describe what you saw (at least 5 characters).' : m);
      }
    },
    onSuccess: () => setDone(true),
    onError: (e: Error) => setError(e.message),
  });

  function here() {
    navigator.geolocation?.getCurrentPosition((p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setError('Could not get your location. Describe the place instead.'), { timeout: 10000 });
  }
  function submit(e: FormEvent) { e.preventDefault(); setError(null); send.mutate(); }

  return (
    <Modal open={open} title={`Report a sighting of ${alert.first_name}`} onClose={onClose}>
      {done ? (
        <div className="space-y-3 text-sm">
          <p className="font-semibold text-leaf">Thank you. Your report has gone straight to the team handling this alert, who will pass it to the police.</p>
          <p>If the child is in front of you or in danger right now, call 112.</p>
          <div className="grid grid-cols-2 gap-2"><a href="tel:112" className="btn bg-red-600 text-white">Call 112</a><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800"><b>If it is happening now, call 112 first.</b> Do not follow or approach anyone.</p>
          <label className="label" htmlFor="s-place">Where did you see the child?</label>
          <input id="s-place" className="input" required minLength={3} maxLength={160} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Near Ameerpet metro, pillar 1012" />
          <button type="button" onClick={here} className="text-xs font-semibold text-primary underline">{coords ? 'Your current location is attached' : 'Attach my current location'}</button>
          <label className="label" htmlFor="s-time">When?</label>
          <input id="s-time" className="input" type="datetime-local" required value={time} onChange={(e) => setTime(e.target.value)} />
          <label className="label" htmlFor="s-note">What did you see?</label>
          <textarea id="s-note" className="input" rows={2} required minLength={5} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clothes, who they were with, which direction they went" />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="s-name">Your name</label>
              <input id="s-name" className="input" required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="s-phone">Your phone</label>
              <input id="s-phone" className="input" required type="tel" inputMode="tel" autoComplete="tel" minLength={8} maxLength={16} pattern="[+]?[0-9 -]{8,16}" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
          </div>
          <p className="text-[11px] text-muted">All fields are required so the police can call you back to confirm. Your details go only to the alert team and the police, are never shown publicly, and are deleted 30 days after the alert closes.</p>
          {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
          <button type="submit" className="btn w-full bg-red-600 text-white hover:bg-red-700" disabled={send.isPending}>{send.isPending ? 'Sending…' : 'Send sighting'}</button>
        </form>
      )}
    </Modal>
  );
}
