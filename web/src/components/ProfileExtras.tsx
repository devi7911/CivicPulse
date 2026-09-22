import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Download, Mail, MapPinned, Target, Trash2, UserX } from 'lucide-react';
import { LocationPicker } from './IssueMap';
import { Modal } from './Modal';
import { useAuth } from '../hooks/useAuth';
import { ISSUE_CATEGORIES } from '../lib/constants';
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { IssueCategory } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

// Phone and browser notifications for everything that appears in the bell.
export function PushCard({ userId }: { userId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { currentPushSubscription().then((s) => setOn(Boolean(s))).catch(() => setOn(false)); }, []);

  async function toggle() {
    setBusy(true); setMsg(null);
    try {
      if (on) { await disablePush(); setOn(false); setMsg('Notifications are off on this device.'); }
      else { await enablePush(userId); setOn(true); setMsg('Done. You will be notified on this device.'); }
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  return (
    <section className="card space-y-2 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><BellRing size={18} /> Phone notifications</h2>
      <p className="text-xs text-muted">Get a notification when your reports change, when there is a new report in an area you watch, or when a city alert is issued.</p>
      {pushSupported() ? (
        <button type="button" className={`btn w-full ${on ? 'btn-ghost' : 'btn-primary'}`} disabled={busy || on === null} onClick={toggle}>
          {busy ? 'Please wait…' : on ? 'Turn off on this device' : 'Turn on for this device'}
        </button>
      ) : (
        <p className="rounded-xl bg-sand p-3 text-xs">This browser cannot receive notifications. On iPhone, add CivicPulse to your Home Screen first.</p>
      )}
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}
    </section>
  );
}

// Email alerts for everything the citizen follows — works on any device, unlike push, which is
// tied to whichever browser turned it on.
export function EmailAlertsCard({ userId }: { userId: string }) {
  const current = useQuery({
    queryKey: ['email-alerts', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('email_alerts').eq('id', userId).single();
      if (error) throw new Error(error.message);
      return (data as { email_alerts: boolean }).email_alerts;
    },
  });
  const [on, setOn] = useState<boolean | null>(null);
  const shown = on ?? current.data ?? false;
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.from('profiles').update({ email_alerts: next }).eq('id', userId);
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: (next) => { setOn(next); setMsg(next ? 'Done. You will get an email when your reports change.' : 'Email alerts are off.'); },
    onError: (e: Error) => setMsg(friendlyError(e.message)),
  });

  return (
    <section className="card space-y-2 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Mail size={18} /> Email alerts</h2>
      <p className="text-xs text-muted">Get an email at your account address when your reports change, or when a report you follow is updated. Works even if you never open CivicPulse on this device again.</p>
      <button type="button" className={`btn w-full ${shown ? 'btn-ghost' : 'btn-primary'}`} disabled={toggle.isPending || current.isLoading} onClick={() => toggle.mutate(!shown)}>
        {toggle.isPending ? 'Please wait…' : shown ? 'Turn off email alerts' : 'Turn on email alerts'}
      </button>
      {msg && <p role="status" className="text-xs text-muted">{msg}</p>}
    </section>
  );
}

interface WatchArea { id: string; name: string; lat: number; lng: number; radius_m: number }

// Up to five places (home, office, a child's school) to hear about new reports nearby.
export function WatchAreasCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [spot, setSpot] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(500);
  const [error, setError] = useState<string | null>(null);

  const areas = useQuery({
    queryKey: ['watch-areas', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('watch_areas').select('id, name, lat, lng, radius_m').order('created_at');
      if (error) throw new Error(error.message);
      return data as WatchArea[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!spot) throw new Error('Pick the place on the map.');
      const { error } = await supabase.from('watch_areas').insert({ user_id: userId, name: name.trim(), lat: spot.lat, lng: spot.lng, radius_m: radius });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setAdding(false); setName(''); setSpot(null); setError(null); qc.invalidateQueries({ queryKey: ['watch-areas'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('watch_areas').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watch-areas'] }),
  });

  const list = areas.data ?? [];
  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><MapPinned size={18} /> Areas I watch</h2>
      <p className="text-xs text-muted">We notify you about new public reports within the distance you choose. Up to 5 areas.</p>
      <ul className="space-y-1.5">
        {list.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{a.name} <span className="text-muted">· within {a.radius_m >= 1000 ? `${a.radius_m / 1000} km` : `${a.radius_m} m`}</span></span>
            <button type="button" aria-label={`Stop watching ${a.name}`} className="rounded-lg p-2 text-muted hover:text-danger" onClick={() => remove.mutate(a.id)}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
      {list.length < 5 && !adding && <button type="button" className="btn btn-ghost w-full" onClick={() => setAdding(true)}>Watch an area</button>}
      {adding && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <input className="input" required minLength={2} maxLength={60} placeholder="Name, for example Home" aria-label="Area name" value={name} onChange={(e) => setName(e.target.value)} />
          <LocationPicker value={spot} onChange={setSpot} />
          <label className="label" htmlFor="radius">Distance</label>
          <select id="radius" className="input" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {[250, 500, 1000, 2000, 3000].map((r) => <option key={r} value={r}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={add.isPending || !spot}>Save area</button>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{friendlyError(error)}</p>}
        </form>
      )}
    </section>
  );
}

export interface Mission { id: string; title: string; description: string; category: IssueCategory | null; target: number; reward_points: number; ends_at: string; progress: number; completed: boolean }

export function useMissions() {
  return useQuery({
    queryKey: ['missions'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_missions');
      if (error) throw new Error(error.message);
      return data as Mission[];
    },
  });
}

export function MissionList({ missions }: { missions: Mission[] }) {
  if (missions.length === 0) return <p className="text-sm text-muted">No missions are running right now. Check back soon.</p>;
  return (
    <ul className="space-y-3">
      {missions.map((m) => (
        <li key={m.id} className="rounded-xl border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{m.title}</p>
            <span className={`status ${m.completed ? 'status-resolved' : 'status-progress'}`}>{m.completed ? 'Done' : `+${m.reward_points} pts`}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">{m.description}{m.category ? ` · ${ISSUE_CATEGORIES[m.category]}` : ''}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-valuemin={0} aria-valuemax={m.target} aria-valuenow={m.progress}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((100 * m.progress) / m.target)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">{m.progress} of {m.target} · ends {new Date(m.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
        </li>
      ))}
    </ul>
  );
}

export function MissionsCard() {
  const missions = useMissions();
  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Target size={18} /> Missions</h2>
      <MissionList missions={missions.data ?? []} />
    </section>
  );
}

// Download everything we hold about you, or delete your account.
export function DataRightsCard() {
  const { signOut } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const exportData = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_my_data');
      if (error) throw new Error(error.message);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `civicpulse-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw new Error(error.message);
    },
    onSuccess: () => signOut(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-lg font-semibold">Your data</h2>
      <p className="text-xs text-muted">Download a copy of everything CivicPulse holds about you, or delete your account. Your public reports stay, but become anonymous.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="btn btn-ghost" disabled={exportData.isPending} onClick={() => exportData.mutate()}><Download size={16} /> Download my data</button>
        <button type="button" className="btn btn-ghost text-danger" onClick={() => { setTyped(''); setConfirmOpen(true); }}><UserX size={16} /> Delete my account</button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{friendlyError(error)}</p>}
      <Modal open={confirmOpen} title="Delete your account?" onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm">
          <p>This removes your profile, contact details, points, emergency contacts and sign-in. It cannot be undone.</p>
          <label className="label" htmlFor="confirm-del">Type DELETE to confirm</label>
          <input id="confirm-del" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={typed !== 'DELETE' || deleteAccount.isPending} onClick={() => deleteAccount.mutate()}>Delete for good</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
