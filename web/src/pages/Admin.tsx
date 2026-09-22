import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { BADGE, useAdminOverview } from '../components/AdminOverview';
import { AdminDashboard } from '../components/AdminDashboard';
import { StaffReports } from '../components/StaffReports';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Lock, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { DOC_TYPES } from '../components/VerifyFlow';
import { useAuth } from '../hooks/useAuth';
import { ActivityAdmin, AdsAdmin, AlertsAdmin, BusRoutesAdmin, ChildAlertsAdmin, ErrorsAdmin, InsightsAdmin, MissionsAdmin, ModerationAdmin, PeopleAdmin, PetitionsAdmin, RepliesAdmin, SupportAdmin } from './AdminMore';
import { CLOSED_REASONS, EVENT_CATEGORIES, ISSUE_CATEGORIES, ISSUE_COLS, STATUS_CLASS, STATUS_LABEL, formatDate, formatEventTime, isOverdue, timeAgo } from '../lib/constants';
import { signedDocUrl, supabase, uploadAdMedia, uploadPhoto } from '../lib/supabase';
import type { CityEvent, ClosedReason, EventCategory, Helpline, Issue, IssueStatus, UtilityLink } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

// ISO timestamp -> value for <input type="datetime-local"> in the viewer's time zone.
const toLocalInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

const GROUPS = [
  { label: 'Work', tabs: ['issues', 'reports', 'support', 'verify', 'moderation', 'replies'] },
  { label: 'Safety', tabs: ['child', 'alerts'] },
  { label: 'Content', tabs: ['events', 'directory', 'ngos', 'missions', 'buses', 'petitions'] },
  { label: 'Money', tabs: ['ads'] },
  { label: 'Oversight', tabs: ['people', 'insights', 'activity', 'errors'] },
] as const;
type Tab = 'overview' | (typeof GROUPS)[number]['tabs'][number];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Dashboard', issues: 'Tickets', reports: 'Reports', support: 'Support', child: 'Missing child', buses: 'Bus routes', moderation: 'Moderation', ads: 'Ad review', insights: 'Insights', alerts: 'City alerts', petitions: 'Petitions', missions: 'Missions',
  replies: 'Standard replies', people: 'People', activity: 'Activity', errors: 'App errors', events: 'Events', ngos: 'NGOs', directory: 'Directory', verify: 'Verify',
};
const isTab = (v: string | null): v is Tab => Boolean(v && v in TAB_LABEL);

// Hiding this page is only a convenience. The database refuses every write here unless the
// signed-in user really is an admin.
export function Admin() {
  const { userId, isAdmin, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'overview';
  const overview = useAdminOverview(isAdmin);
  // Switching sections refreshes the waiting counts, so badges drop once work is done.
  const setTab = (t: string) => { setParams(t === 'overview' ? {} : { tab: t }); window.scrollTo({ top: 0 }); void overview.refetch(); };

  if (loading) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
  // Signed out (e.g. from the "Open ticketing tool" link): sign in, then come straight back here.
  if (!userId) return <Navigate to="/auth" replace state={{ from: `/admin${raw ? `?tab=${raw}` : ''}` }} />;
  if (!isAdmin) return <Navigate to="/" replace />;

  const chip = (t: Tab) => {
    const key = BADGE[t];
    const n = key && overview.data ? (overview.data[key] as number) : 0;
    return (
      <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`chip shrink-0 ${tab === t ? 'chip-on' : ''}`}>
        {TAB_LABEL[t]}
        {n > 0 && <span className="ms-1.5 rounded-full bg-brick px-1.5 text-[11px] font-bold text-white" aria-label={`, ${n} waiting`}>{n}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div><p className="label">Staff only</p><h1 className="page-title">Admin <span className="marker">console</span></h1></div>
      <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:gap-y-3 lg:overflow-visible lg:px-0" role="tablist" aria-label="Admin sections">
        {chip('overview')}
        {GROUPS.map((g) => (
          <span key={g.label} className="flex shrink-0 items-center gap-2" role="presentation">
            <span className="ms-2 text-[11px] font-bold tracking-wide text-muted uppercase" aria-hidden>{g.label}</span>
            {g.tabs.map((t) => chip(t))}
          </span>
        ))}
      </div>
      {tab === 'overview' && <AdminDashboard onOpen={setTab} />}
      {tab === 'issues' && <IssueQueue userId={userId} />}
      {tab === 'reports' && <StaffReports me={userId} />}
      {tab === 'support' && <SupportAdmin />}
      {tab === 'moderation' && <ModerationAdmin />}
      {tab === 'ads' && <AdsAdmin />}
      {tab === 'child' && <ChildAlertsAdmin />}
      {tab === 'buses' && <BusRoutesAdmin />}
      {tab === 'insights' && <InsightsAdmin />}
      {tab === 'alerts' && <AlertsAdmin />}
      {tab === 'petitions' && <PetitionsAdmin />}
      {tab === 'missions' && <MissionsAdmin />}
      {tab === 'replies' && <RepliesAdmin />}
      {tab === 'people' && <PeopleAdmin userId={userId} />}
      {tab === 'activity' && <ActivityAdmin />}
      {tab === 'errors' && <ErrorsAdmin />}
      {tab === 'events' && <EventsAdmin userId={userId} />}
      {tab === 'ngos' && <NgosAdmin />}
      {tab === 'directory' && <DirectoryAdmin />}
      {tab === 'verify' && <VerifyAdmin />}
    </div>
  );
}

function Notice({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>;
}

function Row({ title, sub, onDelete, onEdit, children }: { title: string; sub?: string; onDelete?: () => void; onEdit?: () => void; children?: ReactNode }) {
  return (
    <li className="card-flat flex items-center justify-between gap-3 p-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {children}
        {onEdit && (
          <button type="button" aria-label={`Edit ${title}`} onClick={onEdit}
            className="rounded-lg border border-line bg-card p-2 hover:bg-sand"><Pencil size={15} /></button>
        )}
        {onDelete && (
          <button type="button" aria-label={`Delete ${title}`} onClick={() => { if (confirm(`Delete "${title}"?`)) onDelete(); }}
            className="rounded-lg border border-line bg-card p-2 hover:bg-blush"><Trash2 size={15} /></button>
        )}
      </span>
    </li>
  );
}

/* ---------------- Issues ---------------- */
// Suggested names keep the public scorecard tidy; any name can still be typed.
const DEPARTMENTS = ['GHMC Roads', 'GHMC Sanitation', 'GHMC Electrical', 'GHMC Parks', 'GHMC Town Planning', 'HMWSSB (Water Board)', 'TGSPDCL (Electricity)', 'Hyderabad Traffic Police'];

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

type IssuePatch = { status?: IssueStatus; assignee?: string; proof?: File; target_date?: string; closed_reason?: ClosedReason; closed_note?: string };

function IssueQueue({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['admin-issues'],
    queryFn: async () => {
      const { data, error } = await supabase.from('issues').select(ISSUE_COLS).in('status', ['pending', 'progress'])
        .order('priority_score', { ascending: false }).order('created_at').limit(60);
      if (error) throw new Error(error.message);
      return data as unknown as Issue[];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, ...a }: IssuePatch & { id: string }) => {
      const patch: Record<string, unknown> = {};
      if (a.assignee !== undefined) patch.assignee = a.assignee || null;
      if (a.target_date !== undefined) patch.target_date = a.target_date || null;
      if (a.closed_reason) { patch.closed_reason = a.closed_reason; patch.closed_note = a.closed_note?.trim() || null; }
      if (a.proof) patch.resolved_photo_path = await uploadPhoto(userId, a.proof);
      if (a.status) patch.status = a.status;
      const { error } = await supabase.from('issues').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setError(null);
      ['admin-issues', 'issues', 'issue-stats', 'scorecard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => { setError(e.message); qc.invalidateQueries({ queryKey: ['admin-claims'] }); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-claims'] }),
  });

  // Who is working on which ticket. Claims older than 4 hours have lapsed.
  const claims = useQuery({
    queryKey: ['admin-claims'],
    queryFn: async () => {
      const since = new Date(Date.now() - CLAIM_HOURS * 3600e3).toISOString();
      const { data, error } = await supabase.from('issue_claims').select('issue_id, admin_id, claimed_at, admin:profiles!issue_claims_admin_id_fkey(display_name)').gt('claimed_at', since);
      if (error) throw new Error(error.message);
      return new Map((data as unknown as Claim[]).map((c) => [c.issue_id, c]));
    },
    refetchInterval: 30_000,
  });
  const claim = useMutation({
    mutationFn: async ({ id, take }: { id: string; take: boolean }) => {
      if (!take) { const { error } = await supabase.rpc('release_issue', { p_id: id }); if (error) throw new Error(error.message); return; }
      const { data, error } = await supabase.rpc('claim_issue', { p_id: id });
      if (error) throw new Error(error.message);
      const r = data as { ok: boolean; by?: string };
      if (!r.ok) throw new Error(`${r.by ?? 'Another admin'} picked this up first.`);
    },
    onSuccess: () => setError(null),
    onError: (e: Error) => setError(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-claims'] }),
  });
  const merge = useMutation({
    mutationFn: async ({ id, ref }: { id: string; ref: string }) => {
      const { error } = await supabase.rpc('merge_duplicate', { p_duplicate: id, p_original_ref: ref });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setError(null); ['admin-issues', 'issues', 'issue-stats', 'admin-claims'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => setError(e.message),
  });

  const items = queue.data ?? [];
  const overdue = items.filter(isOverdue).length;

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 [&>p]:col-span-full">
      <p className="text-sm text-muted">
        {items.length} open · {overdue > 0 ? <span className="font-bold text-brick">{overdue} overdue</span> : 'none overdue'} ·{' '}
        <Link to="/scorecard" className="font-semibold text-primary hover:underline">Public scorecard</Link>
      </p>
      {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}
      {queue.isLoading && <p className="text-sm text-muted">Loading queue…</p>}
      {!queue.isLoading && items.length === 0 && <p className="card-flat border-dashed py-8 text-center text-sm text-muted">Nothing open. The queue is clear.</p>}
      {items.map((it) => (
        <QueueCard key={it.id} it={it} me={userId} claim={claims.data?.get(it.id) ?? null} busy={update.isPending || claim.isPending || merge.isPending}
          onUpdate={(p) => update.mutate({ id: it.id, ...p })} onClaim={(take) => claim.mutate({ id: it.id, take })} onMerge={(ref) => merge.mutate({ id: it.id, ref })} />
      ))}
      <datalist id="departments">{DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
    </div>
  );
}

type ReporterContact = { issue_id: string; name: string; email: string; phone: string };
type Claim = { issue_id: string; admin_id: string; claimed_at: string; admin: { display_name: string } | null };
const CLAIM_HOURS = 4;

function QueueCard({ it, me, claim, busy, onUpdate, onClaim, onMerge }: {
  it: Issue; me: string; claim: Claim | null; busy: boolean;
  onUpdate: (p: IssuePatch) => void; onClaim: (take: boolean) => void; onMerge: (originalRef: string) => void;
}) {
  const mine = claim?.admin_id === me;
  const lockedBy = claim && !mine ? (claim.admin?.display_name ?? 'Another admin') : null;
  const [origRef, setOrigRef] = useState('');
  const deptInputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(it.target_date ?? plusDays(7));
  // Contact details are encrypted; they are decrypted only on request, and each request is audited.
  const [contact, setContact] = useState<ReporterContact | null | undefined>(undefined);
  const [revealing, setRevealing] = useState(false);
  async function reveal() {
    setRevealing(true);
    const { data, error } = await supabase.rpc('admin_reporter_contacts', { p_issues: [it.id] });
    setRevealing(false);
    if (error) { window.alert(error.message); return; }
    setContact(((data as ReporterContact[] | null) ?? [])[0] ?? null);
  }
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<ClosedReason>('other_agency');
  const [note, setNote] = useState('');
  const overdue = isOverdue(it);

  return (
    <div className={`card space-y-3 p-4 ${overdue ? 'border-brick/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-muted">{it.ref_no}</span>
        <span className={STATUS_CLASS[it.status]}>{STATUS_LABEL[it.status]}</span>
        {overdue && <span className="pill-overdue">Overdue</span>}
        <span className="tag">{ISSUE_CATEGORIES[it.category]}</span>
        <span className={`tag ${it.severity === 'high' ? 'bg-blush text-brick' : ''}`}>Priority {it.priority_score}</span>
        {it.confidential && <span className="tag">Confidential</span>}
        {it.reopen_count > 0 && <span className="tag bg-blush text-brick">Reopened ×{it.reopen_count}</span>}
      </div>
      <Link to={`/issues/${it.id}`} className="block text-lg leading-tight font-semibold hover:text-primary">{it.title}</Link>
      <p className="text-xs text-muted">{it.location_text} · {timeAgo(it.created_at)} · {it.upvote_count} backing</p>

      {/* One admin works a ticket at a time; the database enforces this too. */}
      <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${lockedBy ? 'bg-blush text-brick' : mine ? 'bg-primary-soft text-primary' : 'bg-sand/70 text-muted'}`}>
        {lockedBy ? (
          <span className="flex items-center gap-1.5 font-semibold"><Lock size={13} aria-hidden /> {lockedBy} is working on this · {timeAgo(claim!.claimed_at)}</span>
        ) : mine ? (
          <><span className="font-semibold">You are working on this</span>
            <button type="button" className="font-semibold underline" disabled={busy} onClick={() => onClaim(false)}>Release</button></>
        ) : (
          <><span>Nobody is working on this</span>
            <button type="button" className="btn btn-primary min-h-8 px-3 text-xs" disabled={busy} onClick={() => onClaim(true)}>Pick up</button></>
        )}
      </div>

      <fieldset disabled={Boolean(lockedBy)} className="space-y-3 disabled:opacity-50">
      {contact === undefined ? (
        <button type="button" className="inline-flex min-h-8 items-center text-xs font-semibold text-primary underline" disabled={revealing} onClick={reveal}>
          {revealing ? 'Decrypting…' : 'Show reporter contact (logged)'}
        </button>
      ) : contact === null ? (
        <p className="text-xs text-muted">Reported with an account. Reply with a comment on the report.</p>
      ) : (
        <p className="rounded-lg bg-sand/70 px-3 py-2 text-xs">
          <span className="font-semibold">Reported without an account:</span> {contact.name} ·{' '}
          <a href={`tel:${contact.phone}`} className="text-primary underline">{contact.phone}</a> ·{' '}
          <a href={`mailto:${contact.email}`} className="text-primary underline">{contact.email}</a>
          {it.anonymous && <span className="text-muted"> (hidden from the public)</span>}
        </p>
      )}

      <div>
        <label className="label" htmlFor={`as-${it.id}`}>Assigned department</label>
        <input id={`as-${it.id}`} ref={deptInputRef} className="input" maxLength={60} list="departments" defaultValue={it.assignee ?? ''} placeholder="Choose or type a department"
          onBlur={(e) => { if (e.target.value.trim() !== (it.assignee ?? '')) onUpdate({ assignee: e.target.value.trim() }); }} />
        {!it.assignee && (
          <AiSuggestDept issueId={it.id}
            onUse={(dept) => { if (deptInputRef.current) deptInputRef.current.value = dept; onUpdate({ assignee: dept }); }} />
        )}
      </div>

      <div>
        <label className="label" htmlFor={`td-${it.id}`}>Promised fix date (shown publicly)</label>
        <div className="flex gap-2">
          <input id={`td-${it.id}`} type="date" className="input" min={plusDays(0)} value={target} onChange={(e) => setTarget(e.target.value)} />
          {it.status === 'progress' && target !== (it.target_date ?? '') && (
            <button type="button" className="btn btn-ghost shrink-0" disabled={busy || !target} onClick={() => onUpdate({ target_date: target })}>Save date</button>
          )}
        </div>
      </div>

      {it.status === 'pending' && (
        <button type="button" className="btn btn-primary w-full" disabled={busy || !target} onClick={() => onUpdate({ status: 'progress', target_date: target })}>
          Start work, promise fix by {formatDate(target)}
        </button>
      )}
      {it.status === 'progress' && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="btn btn-primary cursor-pointer">
            Upload proof and resolve
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpdate({ status: 'resolved', proof: f }); }} />
          </label>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onUpdate({ status: 'pending' })}>Send back</button>
        </div>
      )}

      {!closing ? (
        <button type="button" className="w-full text-center text-xs font-semibold text-muted hover:text-brick" onClick={() => setClosing(true)}>Close without a fix…</button>
      ) : (
        <div className="space-y-2 rounded-xl border border-line bg-sand/50 p-3">
          <label className="label" htmlFor={`cr-${it.id}`}>Reason (shown publicly)</label>
          <select id={`cr-${it.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value as ClosedReason)}>
            {(Object.keys(CLOSED_REASONS) as ClosedReason[]).map((r) => <option key={r} value={r}>{CLOSED_REASONS[r]}</option>)}
          </select>
          {reason === 'duplicate' ? (
            <>
              <label className="label" htmlFor={`or-${it.id}`}>Reference of the original report</label>
              <input id={`or-${it.id}`} className="input font-mono uppercase" value={origRef} onChange={(e) => setOrigRef(e.target.value)} placeholder="CP-26-000042" pattern="[Cc][Pp]-\d{2}-\d{6}" />
              <p className="text-[11px] text-muted">Backers and followers move to the original, and the reporter is told where to follow it.</p>
            </>
          ) : (
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short explanation, e.g. which agency to contact" aria-label="Explanation" />
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setClosing(false)}>Cancel</button>
            {reason === 'duplicate'
              ? <button type="button" className="btn btn-dark" disabled={busy || !/^cp-\d{2}-\d{6}$/i.test(origRef.trim())} onClick={() => onMerge(origRef.trim())}>Merge into original</button>
              : <button type="button" className="btn btn-dark" disabled={busy} onClick={() => onUpdate({ status: 'closed', closed_reason: reason, closed_note: note })}>Close report</button>}
          </div>
        </div>
      )}
      </fieldset>
    </div>
  );
}

// Suggests a department from the report's own text, using the free-tier Gemini model. The model
// never assigns anything itself — the admin still has to press "Use this".
type AiSuggestion = { department: string; confidence?: string; reason?: string; cached?: boolean };
function AiSuggestDept({ issueId, onUse }: { issueId: string; onUse: (dept: string) => void }) {
  const [state, setState] = useState<AiSuggestion | { error: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function suggest() {
    setLoading(true);
    setState(null);
    const { data, error } = await supabase.rpc('admin_suggest_department', { p_issue: issueId, p_departments: DEPARTMENTS });
    setLoading(false);
    if (error) { setState({ error: friendlyError(error.message) }); return; }
    const r = data as { ok: boolean; department?: string; confidence?: string; reason?: string; cached?: boolean; error?: string };
    setState(r.ok ? { department: r.department!, confidence: r.confidence, reason: r.reason, cached: r.cached } : { error: r.error ?? 'Could not get a suggestion.' });
  }

  if (!state) {
    return (
      <button type="button" className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-primary underline disabled:opacity-60" disabled={loading} onClick={suggest}>
        <Sparkles size={13} /> {loading ? 'Asking the AI…' : 'Suggest department (AI)'}
      </button>
    );
  }
  if ('error' in state) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-xs text-brick">
        {state.error}
        <button type="button" className="font-semibold underline" onClick={suggest}>Try again</button>
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <Sparkles size={13} className="shrink-0 text-primary" aria-hidden />
      <span>AI suggests <b>{state.department}</b>{state.confidence && state.confidence !== 'high' ? ` (${state.confidence} confidence)` : ''}:</span>
      <button type="button" className="font-semibold text-primary underline" onClick={() => onUse(state.department)}>Use this</button>
      {state.reason && <span className="block w-full text-[11px] text-muted">{state.reason}</span>}
    </p>
  );
}

/* ---------------- Events ---------------- */
function EventsAdmin({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const empty = { title: '', description: '', category: 'civic_action' as EventCategory, child_friendly: false, organizer: '', location_text: '', starts_at: '', ends_at: '', capacity: '' };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function startEdit(ev: CityEvent) {
    setEditing(ev.id); setMsg(null);
    setF({ title: ev.title, description: ev.description, category: ev.category, child_friendly: ev.child_friendly, organizer: ev.organizer,
      location_text: ev.location_text, starts_at: toLocalInput(ev.starts_at), ends_at: toLocalInput(ev.ends_at), capacity: ev.capacity ? String(ev.capacity) : '' });
    document.getElementById('et')?.focus();
  }
  function cancelEdit() { setEditing(null); setF(empty); }

  const list = useQuery({
    queryKey: ['admin-events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').order('starts_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as CityEvent[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-events'] }); qc.invalidateQueries({ queryKey: ['events'] }); };

  const create = useMutation({
    mutationFn: async () => {
      const row = {
        title: f.title.trim(), description: f.description.trim(), category: f.category,
        child_friendly: f.child_friendly || f.category === 'children',
        organizer: f.organizer.trim(), location_text: f.location_text.trim(),
        starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(),
        capacity: f.capacity ? Number(f.capacity) : null,
      };
      const { error } = editing
        ? await supabase.from('events').update(row).eq('id', editing)
        : await supabase.from('events').insert({ ...row, created_by: userId });
      if (error) throw new Error(error.message.includes('events_check') ? 'The end time must be after the start time.' : error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: editing ? 'Event updated.' : 'Event published.' }); setEditing(null); setF(empty); refresh(); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('events').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: refresh,
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  function submit(e: FormEvent) { e.preventDefault(); setMsg(null); create.mutate(); }

  return (
    <div className="space-y-5 lg:columns-2 3xl:columns-3 lg:gap-5 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-5">
      <form onSubmit={submit} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">{editing ? 'Edit event' : 'Publish an event'}</h2>
        <div><label className="label" htmlFor="et">Title</label><input id="et" className="input" required minLength={5} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="label" htmlFor="ed">Description</label><textarea id="ed" className="input" rows={3} required minLength={10} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="ec">Category</label>
          <select id="ec" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as EventCategory })}>
            {(Object.keys(EVENT_CATEGORIES) as EventCategory[]).map((c) => <option key={c} value={c}>{EVENT_CATEGORIES[c]}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.child_friendly} onChange={(e) => setF({ ...f, child_friendly: e.target.checked })} /> Family friendly</label>
        <div><label className="label" htmlFor="eo">Organiser</label><input id="eo" className="input" required minLength={2} maxLength={120} value={f.organizer} onChange={(e) => setF({ ...f, organizer: e.target.value })} /></div>
        <div><label className="label" htmlFor="el">Location</label><input id="el" className="input" required minLength={3} maxLength={200} value={f.location_text} onChange={(e) => setF({ ...f, location_text: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="es">Starts</label><input id="es" type="datetime-local" className="input" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></div>
          <div><label className="label" htmlFor="ee">Ends</label><input id="ee" type="datetime-local" className="input" required value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></div>
        </div>
        <div><label className="label" htmlFor="ecap">Capacity (optional)</label><input id="ecap" type="number" min={1} className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></div>
        <Notice msg={msg} />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1" disabled={create.isPending}>{create.isPending ? 'Saving…' : editing ? 'Save changes' : 'Publish event'}</button>
          {editing && <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>}
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">All events</h2>
        <ul className="space-y-2">
          {(list.data ?? []).map((ev) => (
            <Row key={ev.id} title={ev.title} sub={`${formatEventTime(ev.starts_at, ev.ends_at)} · ${ev.rsvp_count} adults, ${ev.children_count} children`} onEdit={() => startEdit(ev)} onDelete={() => remove.mutate(ev.id)} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- NGOs and sponsored posts ---------------- */
interface Ngo { id: string; name: string; donate_url: string; website: string | null; vetted: boolean }
interface Post { id: string; title: string; active: boolean; ngo: { name: string } | null }

function NgosAdmin() {
  const qc = useQueryClient();
  const [ngo, setNgo] = useState({ name: '', description: '', website: '', donate_url: '' });
  const [post, setPost] = useState({ ngo_id: '', title: '', body: '' });
  const [media, setMedia] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ngos = useQuery({
    queryKey: ['admin-ngos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ngos').select('id, name, donate_url, website, vetted').order('name');
      if (error) throw new Error(error.message);
      return data as Ngo[];
    },
  });
  const posts = useQuery({
    queryKey: ['admin-posts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sponsored_posts').select('id, title, active, ngo:ngos(name)').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data as unknown as Post[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-ngos'] }); qc.invalidateQueries({ queryKey: ['admin-posts'] }); qc.invalidateQueries({ queryKey: ['sponsored'] }); };
  const fail = (e: Error) => setMsg({ ok: false, text: e.message.includes('https') || e.message.includes('check') ? 'Links must start with https://' : e.message });

  const addNgo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('ngos').insert({ name: ngo.name.trim(), description: ngo.description.trim(), website: ngo.website.trim() || null, donate_url: ngo.donate_url.trim(), vetted: false });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setNgo({ name: '', description: '', website: '', donate_url: '' }); setMsg({ ok: true, text: 'NGO added. Mark it as vetted once you have checked its registration.' }); refresh(); },
    onError: fail,
  });
  const setVetted = useMutation({
    mutationFn: async (a: { id: string; vetted: boolean }) => { const { error } = await supabase.from('ngos').update({ vetted: a.vetted }).eq('id', a.id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });
  const delNgo = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('ngos').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });
  const addPost = useMutation({
    mutationFn: async () => {
      const up = media ? await uploadAdMedia(media) : null;
      const { error } = await supabase.from('sponsored_posts').insert({
        ngo_id: post.ngo_id, title: post.title.trim(), body: post.body.trim(),
        media_path: up?.path ?? null, media_type: up?.type ?? null,
      });
      if (error && up) await supabase.storage.from('ads').remove([up.path]);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setPost({ ngo_id: '', title: '', body: '' }); setMedia(null); setMsg({ ok: true, text: 'Sponsored post published.' }); refresh(); },
    onError: fail,
  });
  const setActive = useMutation({
    mutationFn: async (a: { id: string; active: boolean }) => { const { error } = await supabase.from('sponsored_posts').update({ active: a.active }).eq('id', a.id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });
  const delPost = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('sponsored_posts').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });

  const vetted = (ngos.data ?? []).filter((n) => n.vetted);

  return (
    <div className="space-y-5 lg:columns-2 3xl:columns-3 lg:gap-5 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-5">
      <Notice msg={msg} />
      <form onSubmit={(e) => { e.preventDefault(); setMsg(null); addNgo.mutate(); }} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">Add an NGO</h2>
        <div><label className="label" htmlFor="nn">Name</label><input id="nn" className="input" required minLength={2} maxLength={120} value={ngo.name} onChange={(e) => setNgo({ ...ngo, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="nd">About</label><input id="nd" className="input" maxLength={300} value={ngo.description} onChange={(e) => setNgo({ ...ngo, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="nw">Website (https)</label><input id="nw" className="input" type="url" pattern="https://.*" value={ngo.website} onChange={(e) => setNgo({ ...ngo, website: e.target.value })} placeholder="https://" /></div>
        <div><label className="label" htmlFor="nu">Donation page (https)</label><input id="nu" className="input" type="url" required pattern="https://.*" value={ngo.donate_url} onChange={(e) => setNgo({ ...ngo, donate_url: e.target.value })} placeholder="https://" /></div>
        <button type="submit" className="btn btn-primary w-full" disabled={addNgo.isPending}>Add NGO</button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">NGOs</h2>
        <p className="text-xs text-muted">Only vetted NGOs can appear in the feed.</p>
        <ul className="space-y-2">
          {(ngos.data ?? []).map((n) => (
            <Row key={n.id} title={n.name} sub={n.donate_url} onDelete={() => delNgo.mutate(n.id)}>
              <button type="button" className={`chip ${n.vetted ? 'chip-on' : ''}`} aria-pressed={n.vetted} onClick={() => setVetted.mutate({ id: n.id, vetted: !n.vetted })}>{n.vetted ? 'Vetted' : 'Not vetted'}</button>
            </Row>
          ))}
        </ul>
      </section>

      <form onSubmit={(e) => { e.preventDefault(); setMsg(null); addPost.mutate(); }} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">New sponsored post</h2>
        <div><label className="label" htmlFor="pn">NGO</label>
          <select id="pn" className="input" required value={post.ngo_id} onChange={(e) => setPost({ ...post, ngo_id: e.target.value })}>
            <option value="">Choose a vetted NGO</option>
            {vetted.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="pt">Headline</label><input id="pt" className="input" required minLength={5} maxLength={120} value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} /></div>
        <div><label className="label" htmlFor="pb">Message</label><textarea id="pb" className="input" rows={3} required minLength={10} maxLength={1000} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} /></div>
        <div>
          <span className="label">Animation or video (recommended)</span>
          <label className="btn btn-ghost w-full cursor-pointer">
            {media ? media.name.slice(0, 32) : 'Choose a GIF, MP4 or WebM'}
            <input type="file" accept="image/gif,video/mp4,video/webm,image/webp,image/jpeg,image/png" className="sr-only" onChange={(e) => setMedia(e.target.files?.[0] ?? null)} />
          </label>
          <p className="mt-1 text-[11px] text-muted">Up to 8 MB. Moving media helps people recognise the post as an ad. Videos play muted on a loop, so do not rely on sound.</p>
        </div>
        <button type="submit" className="btn btn-primary w-full" disabled={addPost.isPending || vetted.length === 0}>{addPost.isPending ? 'Publishing…' : 'Publish post'}</button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sponsored posts</h2>
        <ul className="space-y-2">
          {(posts.data ?? []).map((p) => (
            <Row key={p.id} title={p.title} sub={p.ngo?.name} onDelete={() => delPost.mutate(p.id)}>
              <button type="button" className={`chip ${p.active ? 'chip-on' : ''}`} aria-pressed={p.active} onClick={() => setActive.mutate({ id: p.id, active: !p.active })}>{p.active ? 'Live' : 'Paused'}</button>
            </Row>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Directory: helplines and payment links ---------------- */
function DirectoryAdmin() {
  const qc = useQueryClient();
  const [h, setH] = useState({ name: '', phone: '', area: '', address: '' });
  const [l, setL] = useState({ category: 'electricity', title: '', description: '', url: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const helplines = useQuery({
    queryKey: ['helplines'],
    queryFn: async () => { const { data, error } = await supabase.from('helplines').select('*').order('sort').order('name'); if (error) throw new Error(error.message); return data as Helpline[]; },
  });
  const links = useQuery({
    queryKey: ['utility-links'],
    queryFn: async () => { const { data, error } = await supabase.from('utility_links').select('*').order('sort'); if (error) throw new Error(error.message); return data as UtilityLink[]; },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['helplines'] }); qc.invalidateQueries({ queryKey: ['utility-links'] }); };
  const fail = (e: Error) => setMsg({ ok: false, text: e.message });

  const [editH, setEditH] = useState<string | null>(null);
  const [editL, setEditL] = useState<string | null>(null);
  const addStation = useMutation({
    mutationFn: async () => {
      const row = { name: h.name.trim(), phone: h.phone.trim(), area: h.area.trim() || null, address: h.address.trim() || null };
      const { error } = editH
        ? await supabase.from('helplines').update(row).eq('id', editH)
        : await supabase.from('helplines').insert({ ...row, kind: 'police_station', sort: 50 });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: editH ? 'Entry updated.' : 'Police station added.' }); setEditH(null); setH({ name: '', phone: '', area: '', address: '' }); refresh(); }, onError: fail,
  });
  const delHelpline = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('helplines').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });
  const addLink = useMutation({
    mutationFn: async () => {
      const row = { category: l.category, title: l.title.trim(), description: l.description.trim(), url: l.url.trim() };
      const { error } = editL
        ? await supabase.from('utility_links').update(row).eq('id', editL)
        : await supabase.from('utility_links').insert(row);
      if (error) throw new Error(error.message.includes('check') ? 'The link must start with https://' : error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: editL ? 'Link updated.' : 'Link added.' }); setEditL(null); setL({ category: 'electricity', title: '', description: '', url: '' }); refresh(); }, onError: fail,
  });
  const delLink = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('utility_links').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: refresh, onError: fail,
  });

  return (
    <div className="space-y-5 lg:columns-2 3xl:columns-3 lg:gap-5 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-5">
      <Notice msg={msg} />
      <form onSubmit={(e) => { e.preventDefault(); setMsg(null); addStation.mutate(); }} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">{editH ? 'Edit directory entry' : 'Add a police station'}</h2>
        <p className="text-xs text-muted">Residents whose profile area matches see this station first. Use the number published by the police department.</p>
        <div><label className="label" htmlFor="hn">Station name</label><input id="hn" className="input" required maxLength={120} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="Madhapur Police Station" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="ha">Area</label><input id="ha" className="input" required={!editH} maxLength={80} value={h.area} onChange={(e) => setH({ ...h, area: e.target.value })} placeholder="Madhapur" /></div>
          <div><label className="label" htmlFor="hp">Phone</label><input id="hp" className="input" required type="tel" maxLength={20} value={h.phone} onChange={(e) => setH({ ...h, phone: e.target.value })} /></div>
        </div>
        <div><label className="label" htmlFor="hd">Address (optional)</label><input id="hd" className="input" maxLength={200} value={h.address} onChange={(e) => setH({ ...h, address: e.target.value })} /></div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1" disabled={addStation.isPending}>{editH ? 'Save changes' : 'Add station'}</button>
          {editH && <button type="button" className="btn btn-ghost" onClick={() => { setEditH(null); setH({ name: '', phone: '', area: '', address: '' }); }}>Cancel</button>}
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Emergency directory</h2>
        <ul className="space-y-2">
          {(helplines.data ?? []).map((x) => <Row key={x.id} title={`${x.name} · ${x.phone}`} sub={x.kind === 'police_station' ? `Police station · ${x.area ?? ''}` : 'National helpline'}
            onEdit={() => { setEditH(x.id); setH({ name: x.name, phone: x.phone, area: x.area ?? '', address: x.address ?? '' }); document.getElementById('hn')?.focus(); }} onDelete={() => delHelpline.mutate(x.id)} />)}
        </ul>
      </section>

      <form onSubmit={(e) => { e.preventDefault(); setMsg(null); addLink.mutate(); }} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">{editL ? 'Edit link' : 'Add a payment link'}</h2>
        <div><label className="label" htmlFor="lc">Type</label>
          <select id="lc" className="input" value={l.category} onChange={(e) => setL({ ...l, category: e.target.value })}>
            <option value="electricity">Electricity bill</option><option value="challan">Vehicle challan</option>
            <option value="water">Water bill</option><option value="property_tax">Property tax</option><option value="other">Other services</option>
          </select>
        </div>
        <div><label className="label" htmlFor="lt">Title</label><input id="lt" className="input" required maxLength={120} value={l.title} onChange={(e) => setL({ ...l, title: e.target.value })} /></div>
        <div><label className="label" htmlFor="ld">Description</label><input id="ld" className="input" maxLength={200} value={l.description} onChange={(e) => setL({ ...l, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="lu">Official link (https)</label><input id="lu" className="input" required type="url" pattern="https://.*" value={l.url} onChange={(e) => setL({ ...l, url: e.target.value })} placeholder="https://" /></div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1" disabled={addLink.isPending}>{editL ? 'Save changes' : 'Add link'}</button>
          {editL && <button type="button" className="btn btn-ghost" onClick={() => { setEditL(null); setL({ category: 'electricity', title: '', description: '', url: '' }); }}>Cancel</button>}
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Payment links</h2>
        <ul className="space-y-2">
          {(links.data ?? []).map((x) => <Row key={x.id} title={x.title} sub={x.url}
            onEdit={() => { setEditL(x.id); setL({ category: x.category, title: x.title, description: x.description, url: x.url }); document.getElementById('lt')?.focus(); }} onDelete={() => delLink.mutate(x.id)} />)}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Verification review ---------------- */
interface VRequest { id: string; doc_type: keyof typeof DOC_TYPES; doc_path: string | null; created_at: string; user: { display_name: string; account_type: string; org_name: string | null } | null }

function VerifyAdmin() {
  const qc = useQueryClient();
  const { refreshProfile } = useAuth();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = useQuery({
    queryKey: ['admin-verifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('verification_requests')
        .select('id, doc_type, doc_path, created_at, user:profiles!verification_requests_user_id_fkey(display_name, account_type, org_name)')
        .eq('status', 'pending').order('created_at');
      if (error) throw new Error(error.message);
      return data as unknown as VRequest[];
    },
  });

  async function view(path: string) {
    try { window.open(await signedDocUrl(path), '_blank', 'noopener,noreferrer'); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not open the document.' }); }
  }

  const decide = useMutation({
    mutationFn: async (a: { id: string; approve: boolean }) => {
      const { data, error } = await supabase.rpc('review_verification', { p_id: a.id, p_approve: a.approve, p_note: notes[a.id]?.trim() || null });
      if (error) throw new Error(error.message);
      // The document is no longer needed once a decision exists, so delete it right away.
      if (data) await supabase.storage.from('id-docs').remove([data as string]);
      return a.approve;
    },
    onSuccess: (approved) => { setMsg({ ok: true, text: approved ? 'Approved. The document has been deleted.' : 'Rejected. The document has been deleted.' }); qc.invalidateQueries({ queryKey: ['admin-verifications'] }); refreshProfile(); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 [&>p]:col-span-full">
      <Notice msg={msg} />
      <p className="text-xs text-muted">Check that the name on the ID matches the profile name. The document is deleted automatically when you approve or reject.</p>
      {pending.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!pending.isLoading && (pending.data?.length ?? 0) === 0 && <p className="card-flat border-dashed py-8 text-center text-sm text-muted">No requests waiting.</p>}
      {(pending.data ?? []).map((r) => (
        <div key={r.id} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-display text-lg font-semibold">{r.user?.display_name ?? 'Unknown user'}</p>
            <span className="status status-pending">Pending</span>
          </div>
          <p className="text-xs text-muted">{DOC_TYPES[r.doc_type]} · submitted {timeAgo(r.created_at)}{r.user && r.user.account_type !== 'individual' ? ` · ${r.user.account_type}: ${r.user.org_name ?? 'no name given'}` : ''}</p>
          {r.doc_type === 'masked_aadhaar' && <AadhaarCheck requestId={r.id} />}
          {r.doc_path && <button type="button" className="btn btn-ghost w-full" onClick={() => view(r.doc_path!)}><Eye size={16} /> View document (link expires in 2 minutes)</button>}
          <div><label className="label" htmlFor={`note-${r.id}`}>Note to the user (optional, shown if rejected)</label>
            <input id={`note-${r.id}`} className="input" maxLength={300} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}>Approve</button>
            <button type="button" className="btn btn-ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// The last 4 digits are encrypted at rest; decrypted only on request, and every request is logged.
function AadhaarCheck({ requestId }: { requestId: string }) {
  const [last4, setLast4] = useState<string | null | undefined>(undefined);
  const [revealing, setRevealing] = useState(false);
  async function reveal() {
    setRevealing(true);
    const { data, error } = await supabase.rpc('admin_aadhaar_last4', { p_request: requestId });
    setRevealing(false);
    if (error) { window.alert(error.message); return; }
    setLast4((data as string | null) ?? null);
  }
  if (last4 === undefined) {
    return (
      <button type="button" className="inline-flex min-h-8 items-center text-xs font-semibold text-primary underline" disabled={revealing} onClick={reveal}>
        {revealing ? 'Decrypting…' : 'Show Aadhaar last 4 digits (logged)'}
      </button>
    );
  }
  return last4 ? (
    <p className="text-xs"><b>Check:</b> the masked Aadhaar must end in <span className="font-mono font-bold">{last4}</span> and the name must match. Reject if more than 4 digits are visible.</p>
  ) : (
    <p className="text-xs text-muted">No Aadhaar digits were recorded for this request.</p>
  );
}
