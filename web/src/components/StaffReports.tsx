import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Lock, MessageSquare, Search, ThumbsUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ISSUE_CATEGORIES, ISSUE_COLS, STATUS_CLASS, STATUS_LABEL, isOverdue, timeAgo } from '../lib/constants';
import { friendlyError } from '../lib/friendlyError';
import type { Issue, IssueCategory, IssueStatus } from '../lib/types';

// The staff view of all reports: status and handling details at a glance, with a quick reply.
// Working a ticket (status, department, fix date) stays in the ticketing tool.
const PAGE = 30;
type Claim = { issue_id: string; admin_id: string; admin: { display_name: string } | null };

export function StaffReports({ me }: { me: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<IssueStatus | 'open' | 'all'>('open');
  const [category, setCategory] = useState<IssueCategory | ''>('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [replying, setReplying] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['staff-reports', status, category, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('issues').select(ISSUE_COLS).order('updated_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (status === 'open') query = query.in('status', ['pending', 'progress']);
      else if (status !== 'all') query = query.eq('status', status);
      if (category) query = query.eq('category', category);
      const s = search.trim();
      if (s) query = /^cp-\d{2}-\d{1,6}$/i.test(s) ? query.ilike('ref_no', `%${s}%`) : query.or(`title.ilike.%${s.replace(/[%,()]/g, ' ')}%,location_text.ilike.%${s.replace(/[%,()]/g, ' ')}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as unknown as Issue[];
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });

  const claims = useQuery({
    queryKey: ['admin-claims-names'],
    queryFn: async () => {
      const since = new Date(Date.now() - 4 * 3600e3).toISOString();
      const { data, error } = await supabase.from('issue_claims').select('issue_id, admin_id, admin:profiles!issue_claims_admin_id_fkey(display_name)').gt('claimed_at', since);
      if (error) throw new Error(error.message);
      return new Map((data as unknown as Claim[]).map((c) => [c.issue_id, c]));
    },
    refetchInterval: 30_000,
  });

  const rows = list.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <form className="card flex flex-wrap items-end gap-3 p-3" role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(q); }}>
        <div className="min-w-56 flex-1">
          <label className="label mb-1 block" htmlFor="sr-q">Search</label>
          <div className="relative">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
            <input id="sr-q" className="input ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, title or place" />
          </div>
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="sr-s">Status</label>
          <select id="sr-s" className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Open (pending and in progress)</option>
            <option value="all">All</option>
            {(Object.keys(STATUS_LABEL) as IssueStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="sr-c">Category</label>
          <select id="sr-c" className="input" value={category} onChange={(e) => setCategory(e.target.value as IssueCategory | '')}>
            <option value="">All categories</option>
            {Object.entries(ISSUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {list.isError && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError((list.error as Error).message)}</p>}
      {list.isLoading && <p className="text-sm text-muted">Loading reports…</p>}
      {!list.isLoading && rows.length === 0 && <p className="card-flat py-8 text-center text-sm text-muted">No reports match.</p>}

      <ul className="space-y-2">
        {rows.map((it) => {
          const c = claims.data?.get(it.id);
          const overdue = isOverdue(it);
          return (
            <li key={it.id} className={`card p-3 ${overdue ? 'border-brick/40' : ''}`}>
              <div className="grid gap-x-6 gap-y-2 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-mono font-semibold text-muted">{it.ref_no}</span>
                    <span className={STATUS_CLASS[it.status]}>{STATUS_LABEL[it.status]}</span>
                    {overdue && <span className="pill-overdue">Overdue</span>}
                    <span className="tag">{ISSUE_CATEGORIES[it.category]}</span>
                    {it.severity === 'high' && <span className="tag bg-blush text-brick">High severity</span>}
                    {it.reopen_count > 0 && <span className="tag bg-blush text-brick">Reopened ×{it.reopen_count}</span>}
                    {it.confidential && <span className="tag">Confidential</span>}
                    {it.hidden && <span className="tag inline-flex items-center gap-1"><EyeOff size={11} /> Hidden</span>}
                  </p>
                  <Link to={`/issues/${it.id}`} className="mt-1 block truncate font-semibold hover:text-primary">{it.title}</Link>
                  <p className="mt-0.5 text-xs text-muted">{it.location_text} · reported {timeAgo(it.created_at)} · updated {timeAgo(it.updated_at ?? it.created_at)}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-paper px-3 py-2 text-xs sm:grid-cols-4 xl:bg-transparent xl:p-0">
                  <div><dt className="text-muted">Department</dt><dd className={it.assignee ? 'font-semibold' : 'font-semibold text-brick'}>{it.assignee ?? 'None'}</dd></div>
                  <div><dt className="text-muted">Handled by</dt><dd className="font-semibold">{c ? (c.admin_id === me ? 'You' : <span className="inline-flex items-center gap-1"><Lock size={11} />{c.admin?.display_name ?? 'Admin'}</span>) : '—'}</dd></div>
                  <div><dt className="text-muted">Backing</dt><dd className="inline-flex items-center gap-1 font-semibold"><ThumbsUp size={11} />{it.upvote_count}</dd></div>
                  <div><dt className="text-muted">Comments</dt><dd className="inline-flex items-center gap-1 font-semibold"><MessageSquare size={11} />{it.comment_count}</dd></div>
                </dl>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 border-t border-line pt-2 text-xs font-semibold">
                <button type="button" className="text-primary hover:underline" aria-expanded={replying === it.id} onClick={() => setReplying(replying === it.id ? null : it.id)}>
                  {replying === it.id ? 'Cancel reply' : 'Reply as staff'}
                </button>
                <Link to={`/issues/${it.id}`} className="text-primary hover:underline">Open report</Link>
                {(it.status === 'pending' || it.status === 'progress') && <Link to="/admin?tab=issues" className="text-primary hover:underline">Work on it in the ticketing tool</Link>}
              </div>
              {replying === it.id && <QuickReply issueId={it.id} me={me} onDone={() => { setReplying(null); qc.invalidateQueries({ queryKey: ['staff-reports'] }); }} />}
            </li>
          );
        })}
      </ul>
      {list.hasNextPage && (
        <button type="button" className="btn btn-ghost w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function QuickReply({ issueId, me, onDone }: { issueId: string; me: string; onDone: () => void }) {
  const [body, setBody] = useState('');
  const templates = useQuery({
    queryKey: ['response-templates'],
    queryFn: async () => { const { data, error } = await supabase.from('response_templates').select('id, title, body').order('title'); if (error) throw new Error(error.message); return data as { id: string; title: string; body: string }[]; },
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('comments').insert({ issue_id: issueId, author_id: me, body: body.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 space-y-2 rounded-lg bg-primary-soft/50 p-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      {(templates.data?.length ?? 0) > 0 && (
        <select className="input" aria-label="Insert a standard reply" value="" onChange={(e) => { const t = templates.data?.find((x) => x.id === e.target.value); if (t) setBody(t.body); }}>
          <option value="">Insert a standard reply…</option>
          {templates.data!.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}
      <textarea className="input" rows={3} maxLength={500} required value={body} onChange={(e) => setBody(e.target.value)}
        aria-label="Staff reply" placeholder="Update or answer the reporter. Shown with a Staff label; the reporter and followers are notified." />
      {send.isError && <p role="alert" className="text-xs font-semibold text-brick">{friendlyError((send.error as Error).message)}</p>}
      <button type="submit" className="btn btn-primary" disabled={!body.trim() || send.isPending}>{send.isPending ? 'Posting…' : 'Post staff reply'}</button>
    </form>
  );
}
