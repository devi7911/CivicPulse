import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Users } from 'lucide-react';
import { FlagButton, HideToggle } from '../components/Moderation';
import { useAuth } from '../hooks/useAuth';
import { ISSUE_CATEGORIES, timeAgo } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { IssueCategory } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

export interface Proposal {
  id: string; title: string; body: string; category: IssueCategory; threshold: number; support_count: number;
  status: 'open' | 'threshold' | 'responded'; decision: 'adopted' | 'partial' | 'rejected' | 'study' | null;
  response: string | null; responded_at: string | null; hidden: boolean; created_at: string;
}

export const DECISION_LABEL = { adopted: 'Adopted', partial: 'Partly adopted', rejected: 'Not adopted', study: 'Under study' } as const;

export function useProposals() {
  return useQuery({
    queryKey: ['proposals'],
    queryFn: async () => {
      const { data, error } = await supabase.from('proposals')
        .select('id, title, body, category, threshold, support_count, status, decision, response, responded_at, hidden, created_at')
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data as Proposal[];
    },
  });
}

// Citizens propose an improvement; 100 supporters oblige an official public response.
export function Petitions() {
  const { userId, isGuest, isAdmin } = useAuth();
  const qc = useQueryClient();
  const canAct = Boolean(userId) && !isGuest;
  const [form, setForm] = useState<{ title: string; body: string; category: IssueCategory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'responded'>('open');

  const proposals = useProposals();
  const mine = useQuery({
    queryKey: ['proposal-supports', userId],
    enabled: canAct,
    queryFn: async () => {
      const { data, error } = await supabase.from('proposal_supports').select('proposal_id');
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r) => r.proposal_id as string));
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('proposals').insert({ author_id: userId!, title: form!.title.trim(), body: form!.body.trim(), category: form!.category });
      if (error) throw new Error(error.message.includes('check') ? 'Title needs 10 to 120 characters and the description at least 30.' : error.message);
    },
    onSuccess: () => { setForm(null); setError(null); qc.invalidateQueries({ queryKey: ['proposals'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (id: string) => {
      const res = mine.data?.has(id)
        ? await supabase.from('proposal_supports').delete().eq('proposal_id', id).eq('user_id', userId!)
        : await supabase.from('proposal_supports').insert({ proposal_id: id, user_id: userId! });
      if (res.error) throw new Error(res.error.message);
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal-supports'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const list = (proposals.data ?? []).filter((p) => (tab === 'responded' ? p.status === 'responded' : p.status !== 'responded'));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Have your say</p>
          <h1 className="page-title">Petitions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Suggest an improvement for your area. When 100 people support a petition, the city team must reply publicly here.</p>
        </div>
        {canAct ? (
          !form && <button type="button" className="btn btn-primary" onClick={() => setForm({ title: '', body: '', category: 'other' })}><Megaphone size={16} /> Start a petition</button>
        ) : (
          <Link to="/auth" className="btn btn-ghost">Sign in to start or support</Link>
        )}
      </div>

      {form && (
        <form className="card space-y-2 p-4 lg:max-w-2xl" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="label" htmlFor="p-title">What should change?</label>
          <input id="p-title" className="input" required minLength={10} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Add a pedestrian crossing at Kondapur junction" />
          <label className="label" htmlFor="p-body">Why does it matter?</label>
          <textarea id="p-body" className="input" rows={5} required minLength={30} maxLength={3000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <label className="label" htmlFor="p-cat">Topic</label>
          <select id="p-cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as IssueCategory })}>
            {Object.entries(ISSUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <p className="text-[11px] text-muted">You can start 2 petitions every 30 days. Keep it respectful and about public matters.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Publishing…' : 'Publish'}</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}

      <div role="tablist" className="flex gap-2">
        {(['open', 'responded'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} className={`chip ${tab === t ? 'chip-on' : ''}`} onClick={() => setTab(t)}>
            {t === 'open' ? 'Collecting support' : 'Answered'}
          </button>
        ))}
      </div>

      {proposals.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!proposals.isLoading && list.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">{tab === 'open' ? 'No petitions yet. Start the first one.' : 'No answered petitions yet.'}</p>}

      <ul className="grid gap-4 lg:grid-cols-2 3xl:grid-cols-3">
        {list.map((p) => {
          const pct = Math.min(100, Math.round((100 * p.support_count) / p.threshold));
          const supported = mine.data?.has(p.id);
          return (
            <li key={p.id} className="card flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tag">{ISSUE_CATEGORIES[p.category]}</span>
                {p.status === 'threshold' && <span className="status status-progress">Awaiting official response</span>}
                {p.decision && <span className={`status ${p.decision === 'rejected' ? 'status-closed' : 'status-resolved'}`}>{DECISION_LABEL[p.decision]}</span>}
                {p.hidden && <span className="pill-overdue">Hidden</span>}
                <span className="ml-auto text-[11px] text-muted">{timeAgo(p.created_at)}</span>
              </div>
              <h2 className="text-base font-bold">{p.title}</h2>
              <p className="line-clamp-4 text-sm whitespace-pre-wrap text-ink/80">{p.body}</p>
              <div className="mt-auto space-y-1 pt-1">
                <div className="h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                <p className="flex items-center gap-1 text-xs text-muted"><Users size={13} /> {p.support_count} of {p.threshold} supporters</p>
              </div>
              {p.response && (
                <div className="rounded-xl bg-primary-soft p-3 text-sm">
                  <p className="text-xs font-bold text-primary">Official response{p.responded_at ? ` · ${timeAgo(p.responded_at)}` : ''}</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{p.response}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {canAct && p.status !== 'responded' && (
                  <button type="button" aria-pressed={Boolean(supported)} disabled={toggle.isPending} onClick={() => toggle.mutate(p.id)} className={`btn flex-1 ${supported ? 'btn-primary' : 'btn-ghost'}`}>
                    {supported ? 'You support this' : 'Support'}
                  </button>
                )}
                {canAct && <FlagButton type="proposal" id={p.id} userId={userId!} compact />}
                {isAdmin && <HideToggle type="proposal" id={p.id} hidden={p.hidden} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
