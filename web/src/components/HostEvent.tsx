import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { EVENT_CATEGORIES, formatEventTime } from '../lib/constants';
import { isOrg } from '../lib/accounts';
import { supabase } from '../lib/supabase';
import type { CityEvent, EventCategory } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

const HOSTS = ['community', 'ngo', 'education', 'government'];

// Verified community groups, NGOs, schools and government bodies publish their own events.
// The database checks the account (can_host_events) and sets the organiser name itself.
export function HostEvent() {
  const { userId, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty = { title: '', description: '', category: 'civic_action' as EventCategory, child_friendly: false, location_text: '', starts_at: '', ends_at: '', capacity: '' };
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const eligibleType = HOSTS.includes(profile?.account_type ?? '');
  const canHost = Boolean(userId) && eligibleType && Boolean(profile?.verified);

  const mine = useQuery({
    queryKey: ['my-events', userId],
    enabled: canHost,
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').eq('created_by', userId!).order('starts_at', { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      return data as CityEvent[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('events').insert({
        title: f.title.trim(), description: f.description.trim(), category: f.category, child_friendly: f.child_friendly || f.category === 'children',
        organizer: profile?.org_name ?? profile?.display_name ?? '', location_text: f.location_text.trim(),
        starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(),
        capacity: f.capacity ? Number(f.capacity) : null, created_by: userId,
      });
      if (error) throw new Error(error.message.includes('events_check') ? 'The end time must be after the start time.' : error.message);
    },
    onSuccess: () => { setF(empty); setOpen(false); setMsg({ ok: true, text: 'Event published.' }); qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['my-events'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('events').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['my-events'] }); },
  });

  if (!userId || !isOrg(profile?.account_type)) return null;
  if (!eligibleType) return null; // businesses advertise instead
  if (!canHost) {
    return (
      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <ShieldCheck size={20} className="text-primary" />
        <p className="min-w-0 flex-1">Verify {profile?.org_name ?? 'your organisation'} to publish events such as drives, camps and awareness sessions.</p>
        <Link to="/profile" className="btn btn-primary min-h-9 px-4 text-xs">Get verified</Link>
      </div>
    );
  }

  function submit(e: FormEvent) { e.preventDefault(); setMsg(null); create.mutate(); }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><CalendarPlus size={18} className="text-primary" /> Host an event as {profile?.org_name}</h2>
        {!open && <button type="button" className="btn btn-primary min-h-9 px-4 text-xs" onClick={() => { setOpen(true); setMsg(null); }}>New event</button>}
      </div>
      {open && (
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
          <input className="input sm:col-span-2" required minLength={5} maxLength={120} placeholder="Title, e.g. Free eye check-up camp" aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className="input sm:col-span-2" rows={2} required minLength={10} maxLength={1000} placeholder="What will happen, who can join, what to bring" aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <select className="input" aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as EventCategory })}>
            {Object.entries(EVENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="input" required minLength={3} maxLength={200} placeholder="Venue" aria-label="Venue" value={f.location_text} onChange={(e) => setF({ ...f, location_text: e.target.value })} />
          <label className="text-xs text-muted">Starts<input className="input mt-1" type="datetime-local" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></label>
          <label className="text-xs text-muted">Ends<input className="input mt-1" type="datetime-local" required value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></label>
          <input className="input" type="number" min={1} max={100000} placeholder="Capacity (optional)" aria-label="Capacity" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.child_friendly} onChange={(e) => setF({ ...f, child_friendly: e.target.checked })} /> Children can take part</label>
          <p className="text-[11px] text-muted sm:col-span-2">Published under {profile?.org_name}. Up to 5 events every 30 days. CivicPulse can remove events that break the rules.</p>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Publishing…' : 'Publish event'}</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>}
      {(mine.data?.length ?? 0) > 0 && (
        <ul className="divide-y divide-line text-sm">
          {mine.data!.map((ev) => (
            <li key={ev.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{ev.title}</span><span className="text-xs text-muted">{formatEventTime(ev.starts_at, ev.ends_at)} · {ev.rsvp_count} going</span></span>
              <button type="button" aria-label={`Delete ${ev.title}`} className="p-1 text-muted hover:text-brick" onClick={() => { if (confirm(`Delete "${ev.title}"?`)) remove.mutate(ev.id); }}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
