import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Baby, CalendarDays, MapPin, Users } from 'lucide-react';
import { Modal } from '../components/Modal';
import { HostEvent } from '../components/HostEvent';
import { useAuth } from '../hooks/useAuth';
import { EVENT_CATEGORIES, formatEventTime } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { CityEvent, EventCategory } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

export function Events() {
  const { userId, isGuest, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [category, setCategory] = useState<EventCategory | 'all'>('all');
  const [kidsOnly, setKidsOnly] = useState(false);
  const [joining, setJoining] = useState<CityEvent | null>(null);
  const [withChildren, setWithChildren] = useState<boolean | null>(null);
  const [childrenCount, setChildrenCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events').select('*').gte('ends_at', new Date().toISOString()).order('starts_at').limit(100);
      if (error) throw new Error(error.message);
      return data as CityEvent[];
    },
  });

  const myRsvps = useQuery({
    queryKey: ['my-rsvps', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('event_rsvps').select('event_id').eq('user_id', userId!);
      if (error) throw new Error(error.message);
      return new Set(data.map((r) => r.event_id as string));
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['my-rsvps'] });
    refreshProfile();
  };

  const join = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('event_rsvps').insert({
        event_id: joining!.id,
        user_id: userId!,
        with_children: Boolean(withChildren),
        children_count: withChildren ? childrenCount : 0,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { closeModal(); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const leave = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', userId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });

  function closeModal() {
    setJoining(null);
    setWithChildren(null);
    setChildrenCount(1);
    setError(null);
  }

  const visible = (events.data ?? []).filter(
    (e) => (category === 'all' || e.category === category) && (!kidsOnly || e.child_friendly || e.category === 'children'),
  );

  return (
    <div className="space-y-4">
      <div><p className="label">What's on</p><h1 className="page-title">Events in <span className="marker">the city</span></h1></div>
      <HostEvent />

      <button type="button" aria-pressed={kidsOnly} onClick={() => setKidsOnly((v) => !v)}
        className={`btn w-full md:w-auto ${kidsOnly ? 'btn-primary' : 'btn-ghost'}`}>
        <Baby size={18} /> {kidsOnly ? 'Showing family-friendly events only' : "Show children's and family events only"}
      </button>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" role="group" aria-label="Filter by category">
        <button type="button" onClick={() => setCategory('all')} className={`chip ${category === 'all' ? 'chip-on' : ''}`}>All</button>
        {(Object.keys(EVENT_CATEGORIES) as EventCategory[]).map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} className={`chip ${category === c ? 'chip-on' : ''}`}>{EVENT_CATEGORIES[c]}</button>
        ))}
      </div>

      {events.isLoading && <p className="py-8 text-center text-sm text-muted">Loading events…</p>}
      {events.isError && <p className="py-8 text-center text-sm text-danger">Could not load events.</p>}
      {!events.isLoading && visible.length === 0 && <p className="py-8 text-center text-sm text-muted">No upcoming events match these filters.</p>}

      <ul className="stagger grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
        {visible.map((ev) => {
          const joined = myRsvps.data?.has(ev.id) ?? false;
          const taken = ev.rsvp_count + ev.children_count;
          const full = ev.capacity != null && taken >= ev.capacity;
          return (
            <li key={ev.id} className="card flex flex-col gap-2.5 p-4 [&>*:last-child]:mt-auto">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tag">{EVENT_CATEGORIES[ev.category]}</span>
                {(ev.child_friendly || ev.category === 'children') && <span className="tag bg-[#e7f6ec] text-leaf">Family friendly</span>}
              </div>
              <h2 className="text-[17px] leading-snug font-semibold">{ev.title}</h2>
              <p className="text-sm text-muted">{ev.description}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted"><CalendarDays size={13} />{formatEventTime(ev.starts_at, ev.ends_at)}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted"><MapPin size={13} />{ev.location_text}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Users size={13} />{taken} going{ev.capacity != null ? ` of ${ev.capacity}` : ''} · by {ev.organizer}
              </p>
              {!userId || isGuest ? (
                <Link to="/auth" className="btn-ghost btn w-full">Sign in to join</Link>
              ) : joined ? (
                <button type="button" className="btn-ghost btn w-full" disabled={leave.isPending} onClick={() => leave.mutate(ev.id)}>You are going · Cancel</button>
              ) : (
                <button type="button" className="btn-primary btn w-full" disabled={full} onClick={() => setJoining(ev)}>{full ? 'Event is full' : 'Join event'}</button>
              )}
            </li>
          );
        })}
      </ul>

      <Modal open={Boolean(joining)} title="Join event" onClose={closeModal}>
        <div className="space-y-4">
          <p className="font-display text-lg leading-tight font-semibold">Will children be participating with you?</p>
          <p className="text-xs text-muted">This helps organisers plan for safety and capacity. We only record a number, never names or ages.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={withChildren === true} onClick={() => setWithChildren(true)} className={`btn ${withChildren === true ? 'btn-primary' : 'btn-ghost'}`}>Yes</button>
            <button type="button" aria-pressed={withChildren === false} onClick={() => setWithChildren(false)} className={`btn ${withChildren === false ? 'btn-primary' : 'btn-ghost'}`}>No</button>
          </div>
          {withChildren && (
            <div>
              <label htmlFor="kids" className="label">How many children?</label>
              <input id="kids" type="number" min={1} max={10} className="input" value={childrenCount}
                onChange={(e) => setChildrenCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
          <button type="button" className="btn-primary btn w-full" disabled={withChildren === null || join.isPending} onClick={() => join.mutate()}>
            {join.isPending ? 'Joining…' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
