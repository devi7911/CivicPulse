import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { HideToggle } from '../components/Moderation';
import { useActiveAlerts } from '../components/CityAlerts';
import { ISSUE_CATEGORIES, timeAgo } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { IssueCategory } from '../lib/types';
import { DECISION_LABEL, useProposals } from './Petitions';
import { CAMPAIGN_STATUS, liveState, totals, type Campaign, type DayStat } from './Advertise';
import { SponsoredBanner } from '../components/FeedCards';
import type { ChildAlert } from '../components/AmberAlerts';
import { geocode } from '../components/PlaceSearch';
import { busesNear, type Stop } from '../lib/transit';
import { ACCOUNT_TYPES, type AccountType } from '../lib/accounts';
import { friendlyError } from '../lib/friendlyError';

type Msg = { ok: boolean; text: string } | null;
function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 16);

/* ---------------- Moderation ---------------- */
interface Flag { id: string; target_type: 'issue' | 'comment' | 'proposal'; target_id: string; reason: string; note: string | null; created_at: string }

export function ModerationAdmin() {
  const qc = useQueryClient();
  const flags = useQuery({
    queryKey: ['admin-flags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('content_flags').select('id, target_type, target_id, reason, note, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return data as Flag[];
    },
  });
  const dismiss = useMutation({
    mutationFn: async (f: { type: Flag['target_type']; id: string }) => {
      const { error } = await supabase.rpc('moderate', { p_type: f.type, p_id: f.id, p_hide: false, p_reason: null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-flags'] }),
  });

  // Group the flags per item so each item is reviewed once.
  const groups = Object.values((flags.data ?? []).reduce<Record<string, { type: Flag['target_type']; id: string; items: Flag[] }>>((acc, f) => {
    (acc[`${f.target_type}:${f.target_id}`] ??= { type: f.target_type, id: f.target_id, items: [] }).items.push(f);
    return acc;
  }, {})).sort((a, b) => b.items.length - a.items.length);

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">Items reported by users. Five reports hide an item automatically until you decide.</p>
      {flags.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!flags.isLoading && groups.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">Nothing to review.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <li key={`${g.type}:${g.id}`} className="card-flat space-y-2 p-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <span className="tag capitalize">{g.type === 'issue' ? 'post' : g.type}</span> {g.items.length} report{g.items.length > 1 ? 's' : ''}
              <span className="ml-auto text-[11px] font-normal text-muted">{timeAgo(g.items[0].created_at)}</span>
            </p>
            <ul className="space-y-0.5 text-xs text-muted">
              {g.items.slice(0, 4).map((f) => <li key={f.id}><span className="font-semibold text-ink">{f.reason.replace('_', ' ')}</span>{f.note ? `: ${f.note}` : ''}</li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              {g.type === 'issue' && <Link to={`/issues/${g.id}`} className="text-xs font-semibold text-primary underline">Open post</Link>}
              {g.type === 'proposal' && <Link to="/petitions" className="text-xs font-semibold text-primary underline">Open petitions</Link>}
              <HideToggle type={g.type} id={g.id} hidden={false} />
              <button type="button" className="min-h-8 px-1 text-[11px] font-semibold text-muted hover:text-ink" onClick={() => dismiss.mutate({ type: g.type, id: g.id })}>Dismiss, keep visible</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- People ---------------- */
interface AdminUser { id: string; display_name: string; email: string | null; role: 'citizen' | 'admin'; banned: boolean; verified: boolean; points: number; reports: number; is_guest: boolean; created_at: string; account_type: AccountType; org_name: string | null }

export function PeopleAdmin({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const users = useQuery({
    queryKey: ['admin-users', search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users', { p_query: search || null });
      if (error) throw new Error(error.message);
      return data as AdminUser[];
    },
  });
  const set = useMutation({
    mutationFn: async (p: { id: string; role?: 'citizen' | 'admin'; banned?: boolean }) => {
      const { error } = await supabase.rpc('admin_set_user', { p_user: p.id, p_role: p.role ?? null, p_banned: p.banned ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Saved.' }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const setType = useMutation({
    mutationFn: async (p: { id: string; type: AccountType; org: string | null }) => {
      const { error } = await supabase.rpc('admin_set_account_type', { p_user: p.id, p_account_type: p.type, p_org_name: p.org });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Account type changed. The account must verify again.' }); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  function changeType(u: AdminUser, type: AccountType) {
    let org: string | null = null;
    if (type !== 'individual') {
      org = window.prompt(`${ACCOUNT_TYPES[type].orgLabel} for ${u.display_name}`, u.org_name ?? '');
      if (org === null) return;
    }
    if (confirm(`Change ${u.display_name} to "${ACCOUNT_TYPES[type].label}"? Their verification will be removed until they verify again.`)) setType.mutate({ id: u.id, type, org });
  }

  return (
    <section className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim().slice(0, 60)); }}>
        <input className="input" placeholder="Search name, email or organisation" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-ghost">Search</button>
      </form>
      <Notice msg={msg} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-line bg-sand/60 text-left text-xs text-muted">
            <tr><th className="px-3 py-2">Person</th><th className="px-3 py-2">Account type</th><th className="px-3 py-2">Joined</th><th className="px-3 py-2 text-right">Reports</th><th className="px-3 py-2 text-right">Points</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Access</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className={u.banned ? 'bg-blush/50' : ''}>
                <td className="px-3 py-2"><span className="block font-semibold">{u.display_name}{u.verified ? ' ✓' : ''}</span><span className="block text-xs text-muted">{u.is_guest ? 'Guest' : u.email}</span></td>
                <td className="px-3 py-2">
                  <select className="input min-h-9 py-1 text-xs" aria-label={`Account type of ${u.display_name}`} value={u.account_type} disabled={u.is_guest || setType.isPending}
                    onChange={(e) => changeType(u, e.target.value as AccountType)}>
                    {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>)}
                  </select>
                  {u.org_name && <span className="mt-0.5 block max-w-[12rem] truncate text-[11px] text-muted">{u.org_name}</span>}
                  <span className={`text-[11px] font-semibold ${u.verified ? 'text-leaf' : 'text-muted'}`}>{u.verified ? 'Verified' : 'Not verified'}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted">{timeAgo(u.created_at)}</td>
                <td className="px-3 py-2 text-right">{u.reports}</td>
                <td className="px-3 py-2 text-right">{u.points}</td>
                <td className="px-3 py-2">
                  <select className="input min-h-9 py-1 text-xs" aria-label={`Role of ${u.display_name}`} value={u.role} disabled={u.id === userId || u.is_guest || set.isPending}
                    onChange={(e) => { const role = e.target.value as AdminUser['role']; if (confirm(`Make ${u.display_name} ${role === 'admin' ? 'an admin' : 'a citizen'}?`)) set.mutate({ id: u.id, role }); }}>
                    <option value="citizen">Citizen</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <button type="button" disabled={u.id === userId || set.isPending} className={`btn min-h-9 px-3 text-xs ${u.banned ? 'btn-ghost' : 'btn-danger'}`}
                    onClick={() => { if (confirm(u.banned ? `Restore ${u.display_name}?` : `Block ${u.display_name} from posting?`)) set.mutate({ id: u.id, banned: !u.banned }); }}>
                    {u.banned ? 'Unblock' : 'Block'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">Shows the 50 newest matches. Every change here is recorded in Activity.</p>
    </section>
  );
}

/* ---------------- Activity (audit log) ---------------- */
interface Audit { id: number; action: string; target_type: string; target_id: string | null; details: Record<string, unknown>; created_at: string; actor: { display_name: string } | null }

export function ActivityAdmin() {
  const log = useQuery({
    queryKey: ['admin-audit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('admin_audit').select('id, action, target_type, target_id, details, created_at, actor:profiles!admin_audit_actor_id_fkey(display_name)').order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data as unknown as Audit[];
    },
  });
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">Every admin action, newest first. This log cannot be edited.</p>
      <ul className="divide-y divide-line card">
        {(log.data ?? []).map((a) => {
          const d = Object.entries(a.details ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
          return (
            <li key={a.id} className="px-4 py-2.5 text-sm">
              <p><span className="font-semibold">{a.actor?.display_name ?? 'System'}</span> <span className="text-muted">{a.action}</span> {a.target_type}</p>
              <p className="truncate text-xs text-muted">{d || a.target_id} · {timeAgo(a.created_at)}</p>
            </li>
          );
        })}
        {log.data?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No admin activity yet.</li>}
      </ul>
    </section>
  );
}

/* ---------------- Insights ---------------- */
interface Insights {
  weeks: { label: string; reported: number; resolved: number }[] | null;
  by_category: { category: IssueCategory; total: number; open: number }[] | null;
  avg_days_to_fix: number | null; open_flags: number; guest_share: number; users: number; reports_30d: number;
}

export function InsightsAdmin() {
  const ins = useQuery({
    queryKey: ['admin-insights'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_insights');
      if (error) throw new Error(error.message);
      return data as Insights;
    },
  });
  const d = ins.data;
  if (!d) return <p className="text-sm text-muted">{ins.isError ? 'Could not load insights.' : 'Loading…'}</p>;
  const weeks = d.weeks ?? [];
  const max = Math.max(1, ...weeks.flatMap((w) => [w.reported, w.resolved]));
  const cats = d.by_category ?? [];
  const catMax = Math.max(1, ...cats.map((c) => c.total));

  return (
    <section className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([['Reports, 30 days', d.reports_30d], ['Avg days to fix', d.avg_days_to_fix ?? 'n/a'], ['Guest reports', `${d.guest_share}%`], ['Open flags', d.open_flags], ['People', d.users]] as const).map(([k, v]) => (
          <div key={k} className="card flex flex-col-reverse px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="text-2xl font-bold">{v}</dd></div>
        ))}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-base font-bold">Reported vs resolved, last 12 weeks</h2>
          <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label="Weekly reported and resolved counts">
            {weeks.map((w) => (
              <div key={w.label} className="flex flex-1 flex-col items-center gap-1" title={`${w.label}: ${w.reported} reported, ${w.resolved} resolved`}>
                <div className="flex h-32 w-full items-end gap-0.5">
                  <span className="flex-1 rounded-t bg-primary" style={{ height: `${(100 * w.reported) / max}%` }} />
                  <span className="flex-1 rounded-t bg-leaf" style={{ height: `${(100 * w.resolved) / max}%` }} />
                </div>
                <span className="text-[9px] whitespace-nowrap text-muted">{w.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-primary" />Reported</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-leaf" />Resolved</span></p>
        </div>
        <div className="card p-4">
          <h2 className="text-base font-bold">By category</h2>
          <ul className="mt-3 space-y-2.5">
            {cats.map((c) => (
              <li key={c.category} className="text-sm">
                <p className="flex justify-between"><span>{ISSUE_CATEGORIES[c.category]}</span><span className="text-muted">{c.open} open / {c.total}</span></p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-primary" style={{ width: `${(100 * c.total) / catMax}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------- City alerts ---------------- */
const ALERT_KINDS = { flood: 'Flooding', power: 'Power cut', water: 'Water cut', traffic: 'Traffic', health: 'Health', other: 'Other' } as const;

export function AlertsAdmin() {
  const qc = useQueryClient();
  const active = useActiveAlerts();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ kind: 'power', severity: 'warning', title: '', body: '', area: '', link: '', ends_at: inDays(1) });

  const publish = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('city_alerts').insert({
        kind: f.kind, severity: f.severity, title: f.title.trim(), body: f.body.trim(), area: f.area.trim() || null,
        link: f.link.trim() || null, ends_at: new Date(f.ends_at).toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Alert published and sent to everyone with an account.' }); setF({ ...f, title: '', body: '', area: '', link: '' }); qc.invalidateQueries({ queryKey: ['city-alerts'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const end = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('city_alerts').update({ ends_at: new Date(Date.now() + 1000).toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['city-alerts'] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!confirm('Publish this alert? It notifies every account holder.')) return;
    publish.mutate();
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <form onSubmit={submit} className="card space-y-2 p-4">
        <h2 className="text-base font-bold">Publish a city alert</h2>
        <div className="grid grid-cols-2 gap-2">
          <select className="input" aria-label="Type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(ALERT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" aria-label="Severity" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="info">Information</option><option value="warning">Warning</option><option value="danger">Danger</option></select>
        </div>
        <input className="input" required minLength={5} maxLength={120} placeholder="Title, e.g. Power cut in Madhapur" aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" required rows={3} minLength={5} maxLength={1000} placeholder="What is happening and what people should do" aria-label="Details" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <input className="input" maxLength={120} placeholder="Area (optional)" aria-label="Area" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
        <input className="input" type="url" pattern="https://.*" placeholder="Official link, https:// (optional)" aria-label="Link" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
        <label className="label" htmlFor="al-end">Show until</label>
        <input id="al-end" className="input" type="datetime-local" required value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
        <button type="submit" className="btn btn-primary w-full" disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish alert'}</button>
        <Notice msg={msg} />
      </form>
      <div className="space-y-2">
        <h2 className="text-base font-bold">Live now</h2>
        {(active.data ?? []).length === 0 && <p className="text-sm text-muted">No active alerts.</p>}
        <ul className="space-y-2">
          {(active.data ?? []).map((a) => (
            <li key={a.id} className="card-flat flex items-center justify-between gap-2 p-3 text-sm">
              <span className="min-w-0"><span className="block truncate font-bold">{a.title}</span><span className="text-xs text-muted">{a.severity} · until {new Date(a.ends_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></span>
              <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => end.mutate(a.id)}>End now</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- Missions ---------------- */
interface MissionRow { id: string; title: string; description: string; category: IssueCategory | null; target: number; reward_points: number; ends_at: string }

export function MissionsAdmin() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ title: '', description: '', category: '', target: 3, reward_points: 30, ends_at: inDays(14) });
  const list = useQuery({
    queryKey: ['admin-missions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('missions').select('id, title, description, category, target, reward_points, ends_at').order('ends_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as MissionRow[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('missions').insert({ title: f.title.trim(), description: f.description.trim(), category: f.category || null, target: f.target, reward_points: f.reward_points, ends_at: new Date(f.ends_at).toISOString() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Mission started.' }); setF({ ...f, title: '', description: '' }); qc.invalidateQueries({ queryKey: ['admin-missions'] }); qc.invalidateQueries({ queryKey: ['missions'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('missions').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-missions'] }); qc.invalidateQueries({ queryKey: ['missions'] }); },
  });

  return (
    <section className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <form className="card space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); create.mutate(); }}>
        <h2 className="text-base font-bold">New mission</h2>
        <input className="input" required minLength={5} maxLength={80} placeholder="Title" aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" required rows={2} minLength={10} maxLength={400} placeholder="What people should do" aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <select className="input" aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">Any category</option>{Object.entries(ISSUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">Reports needed<input className="input mt-1" type="number" min={1} max={50} value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></label>
          <label className="text-xs text-muted">Reward points<input className="input mt-1" type="number" min={5} max={100} value={f.reward_points} onChange={(e) => setF({ ...f, reward_points: Number(e.target.value) })} /></label>
        </div>
        <label className="label" htmlFor="m-end">Ends</label>
        <input id="m-end" className="input" type="datetime-local" required value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
        <button type="submit" className="btn btn-primary w-full" disabled={create.isPending}>Start mission</button>
        <Notice msg={msg} />
      </form>
      <ul className="space-y-2">
        {(list.data ?? []).map((m) => (
          <li key={m.id} className="card-flat flex items-center justify-between gap-2 p-3 text-sm">
            <span className="min-w-0"><span className="block truncate font-bold">{m.title}</span><span className="text-xs text-muted">{m.target} reports · +{m.reward_points} pts · {new Date(m.ends_at) < new Date() ? 'ended' : `ends ${timeAgo(m.ends_at).replace(' ago', '')}`}</span></span>
            <button type="button" aria-label={`Delete ${m.title}`} className="rounded-lg border border-line p-2 hover:bg-blush" onClick={() => { if (confirm(`Delete "${m.title}"?`)) remove.mutate(m.id); }}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Petitions ---------------- */
export function PetitionsAdmin() {
  const qc = useQueryClient();
  const proposals = useProposals();
  const [drafts, setDrafts] = useState<Record<string, { decision: keyof typeof DECISION_LABEL; response: string }>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const respond = useMutation({
    mutationFn: async (id: string) => {
      const d = drafts[id];
      const { error } = await supabase.rpc('respond_to_proposal', { p_id: id, p_decision: d?.decision ?? 'study', p_response: d?.response ?? '' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Response published. Supporters have been notified.' }); qc.invalidateQueries({ queryKey: ['proposals'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const waiting = (proposals.data ?? []).filter((p) => p.status !== 'responded').sort((a, b) => (b.status === 'threshold' ? 1 : 0) - (a.status === 'threshold' ? 1 : 0) || b.support_count - a.support_count);

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">Petitions that reached 100 supporters are listed first and need a public response. You can respond to any petition earlier.</p>
      <Notice msg={msg} />
      {waiting.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">No petitions waiting.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {waiting.map((p) => {
          const d = drafts[p.id] ?? { decision: 'study' as const, response: '' };
          return (
            <li key={p.id} className="card space-y-2 p-4">
              <p className="flex items-center gap-2 text-xs text-muted">{p.status === 'threshold' && <span className="status status-progress">Response due</span>} {p.support_count}/{p.threshold} supporters</p>
              <h3 className="font-bold">{p.title}</h3>
              <p className="line-clamp-3 text-sm text-ink/80">{p.body}</p>
              <select className="input" aria-label="Decision" value={d.decision} onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, decision: e.target.value as typeof d.decision } })}>
                {Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <textarea className="input" rows={3} minLength={20} maxLength={3000} placeholder="Public response (at least 20 characters)" aria-label="Response" value={d.response} onChange={(e) => setDrafts({ ...drafts, [p.id]: { ...d, response: e.target.value } })} />
              <button type="button" className="btn btn-primary w-full" disabled={d.response.trim().length < 20 || respond.isPending} onClick={() => respond.mutate(p.id)}>Publish response</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- Ad review (marketplace) ---------------- */
type AdRow = Campaign & { advertiser: { id: string; name: string; kind: string; website: string | null; contact_email: string; verified: boolean } | null };

export function AdsAdmin() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const list = useQuery({
    queryKey: ['admin-ads', filter],
    queryFn: async () => {
      let q = supabase.from('ad_campaigns').select('*, advertiser:advertisers(id, name, kind, website, contact_email, verified)').order('created_at', { ascending: false }).limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as unknown as AdRow[];
    },
  });
  const stats = useQuery({
    queryKey: ['admin-ad-stats', (list.data ?? []).map((c) => c.id).join(',')],
    enabled: (list.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('ad_daily_stats').select('campaign_id, day, views, clicks').in('campaign_id', list.data!.map((c) => c.id));
      if (error) throw new Error(error.message);
      return data as DayStat[];
    },
  });
  const review = useMutation({
    mutationFn: async (a: { id: string; approve: boolean; paid?: boolean }) => {
      const { error } = await supabase.rpc('review_campaign', { p_id: a.id, p_approve: a.approve, p_note: notes[a.id] ?? null, p_paid: a.paid ?? null, p_payment_ref: refs[a.id] ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Saved. The advertiser has been notified.' }); qc.invalidateQueries({ queryKey: ['admin-ads'] }); qc.invalidateQueries({ queryKey: ['sponsored'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const verify = useMutation({
    mutationFn: async (a: { id: string; v: boolean }) => { const { error } = await supabase.rpc('verify_advertiser', { p_id: a.id, p_verified: a.v }); if (error) throw new Error(error.message); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-ads'] }),
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['pending', 'approved', 'all'] as const).map((k) => (
          <button key={k} type="button" className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>{k === 'pending' ? 'To review' : k === 'approved' ? 'Approved' : 'All'}</button>
        ))}
        <p className="ml-auto text-xs text-muted">Check: honest claims, no politics or religion, no alcohol, gambling, loans or adult content, https link to the advertiser's own site.</p>
      </div>
      <Notice msg={msg} />
      {list.data?.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">Nothing here.</p>}
      <ul className="grid gap-4 lg:grid-cols-2">
        {(list.data ?? []).map((c) => {
          const t = totals(stats.data, c.id);
          const a = c.advertiser;
          const preview = { id: c.id, title: c.title, body: c.body, media_path: c.media_path, media_type: c.media_type, ngo: { name: a?.name ?? 'Advertiser', donate_url: c.cta_url, website: a?.website ?? null }, cta_label: c.cta_label };
          return (
            <li key={c.id} className="card space-y-2.5 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={CAMPAIGN_STATUS[c.status].cls}>{liveState(c, t.spent)}</span>
                <span className="tag">₹{c.budget_inr.toLocaleString('en-IN')}</span>
                <span className="tag">{c.paid ? `Paid${c.payment_ref ? ` · ${c.payment_ref}` : ''}` : 'Unpaid'}</span>
                <span className="text-muted">{t.views} views · {t.clicks} clicks</span>
              </div>
              <SponsoredBanner post={preview} onDismiss={() => {}} />
              {a && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {a.name} ({a.kind}) · {a.contact_email}{a.website ? ` · ${a.website}` : ''}
                  <button type="button" className="font-semibold text-primary underline" onClick={() => verify.mutate({ id: a.id, v: !a.verified })}>{a.verified ? 'Remove verified' : 'Mark verified'}</button>
                </p>
              )}
              <p className="text-xs text-muted">Link: {c.cta_url} · {new Date(c.starts_at).toLocaleDateString('en-IN')} to {new Date(c.ends_at).toLocaleDateString('en-IN')}{c.target_category ? ` · next to ${ISSUE_CATEGORIES[c.target_category]}` : ''}</p>
              <input className="input" placeholder="Note to advertiser (required to reject)" aria-label="Note" maxLength={300} value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
              <input className="input" placeholder="Payment reference, e.g. UPI or Razorpay ID" aria-label="Payment reference" maxLength={80} value={refs[c.id] ?? ''} onChange={(e) => setRefs({ ...refs, [c.id]: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" disabled={review.isPending} onClick={() => review.mutate({ id: c.id, approve: true })}>Approve</button>
                <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" disabled={review.isPending || !refs[c.id]?.trim()} onClick={() => review.mutate({ id: c.id, approve: true, paid: true })}>Approve + mark paid</button>
                <button type="button" className="btn btn-danger min-h-9 px-3 text-xs" disabled={review.isPending} onClick={() => review.mutate({ id: c.id, approve: false })}>Reject</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- Missing child alerts ---------------- */
type AdminChildAlert = ChildAlert & { fir_ref: string; status: 'active' | 'found' | 'cancelled'; created_at: string; closed_at: string | null };
interface Sighting { id: string; alert_id: string; seen_at: string; place: string; lat: number | null; lng: number | null; note: string; contact_phone: string; reporter_name: string; created_at: string }

export function ChildAlertsAdmin() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [confirm1, setConfirm1] = useState(false);
  const blank = { first_name: '', age: '', gender: '', description: '', last_seen_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), last_seen_place: '', police_station: '', police_phone: '', fir_ref: '' };
  const [f, setF] = useState(blank);

  const list = useQuery({
    queryKey: ['admin-child-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_child_alerts');
      if (error) throw new Error(error.message);
      return data as AdminChildAlert[];
    },
  });
  const sightings = useQuery({
    queryKey: ['admin-sightings'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('child_alert_sightings').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return data as Sighting[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-child-alerts'] }); qc.invalidateQueries({ queryKey: ['child-alerts'] }); };

  const publish = useMutation({
    mutationFn: async () => {
      let path: string | null = null;
      if (photo) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024) throw new Error('Photo must be JPG, PNG or WebP, 5 MB max.');
        path = `${crypto.randomUUID()}.${photo.type.split('/')[1].replace('jpeg', 'jpg')}`;
        const up = await supabase.storage.from('alerts').upload(path, photo, { contentType: photo.type });
        if (up.error) throw new Error(up.error.message);
      }
      const { error } = await supabase.from('child_alerts').insert({
        first_name: f.first_name.trim(), age: f.age ? Number(f.age) : null, gender: f.gender || null, description: f.description.trim() || null,
        photo_path: path, last_seen_at: new Date(f.last_seen_at).toISOString(), last_seen_place: f.last_seen_place.trim(),
        police_station: f.police_station.trim(), police_phone: f.police_phone.trim(), fir_ref: f.fir_ref.trim(),
      });
      if (error) { if (path) await supabase.storage.from('alerts').remove([path]); throw new Error(error.message); }
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Alert published. Everyone with an account has been notified.' }); setF(blank); setPhoto(null); setConfirm1(false); refresh(); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  const close = useMutation({
    mutationFn: async (a: { id: string; status: 'found' | 'cancelled' }) => {
      const { data, error } = await supabase.rpc('close_child_alert', { p_id: a.id, p_status: a.status });
      if (error) throw new Error(error.message);
      if (data) await supabase.storage.from('alerts').remove([data as string]);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Alert closed. The photo and description have been deleted.' }); refresh(); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const renew = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('renew_child_alert', { p_id: id }); if (error) throw new Error(error.message); },
    onSuccess: () => { setMsg({ ok: true, text: 'Extended by 72 hours.' }); refresh(); },
  });

  function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!window.confirm(`Publish a missing-child alert for ${f.first_name}? Every account holder will be notified immediately.`)) return;
    publish.mutate();
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <form onSubmit={submit} className="card space-y-2 border-red-200 p-4">
        <h2 className="text-base font-bold text-red-700">Publish a missing-child alert</h2>
        <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">Only publish when the police have registered a case and asked or agreed for it to be shared. A false alert can put a child in danger.</p>
        <div className="grid grid-cols-3 gap-2">
          <input className="input col-span-2" required maxLength={40} placeholder="First name only" aria-label="First name" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <input className="input" type="number" min={0} max={17} placeholder="Age" aria-label="Age" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} />
        </div>
        <select className="input" aria-label="Gender" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Gender (optional)</option><option value="girl">Girl</option><option value="boy">Boy</option><option value="other">Other</option></select>
        <textarea className="input" rows={2} maxLength={500} placeholder="Clothes, height, distinguishing features" aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <label className="label" htmlFor="ca-photo">Recent photo (from the family, via the police)</label>
        <input id="ca-photo" className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" required minLength={3} maxLength={120} placeholder="Last seen place" aria-label="Last seen place" value={f.last_seen_place} onChange={(e) => setF({ ...f, last_seen_place: e.target.value })} />
          <input className="input" type="datetime-local" required aria-label="Last seen time" value={f.last_seen_at} onChange={(e) => setF({ ...f, last_seen_at: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" required minLength={3} maxLength={80} placeholder="Police station" aria-label="Police station" value={f.police_station} onChange={(e) => setF({ ...f, police_station: e.target.value })} />
          <input className="input" required type="tel" placeholder="Station phone" aria-label="Station phone" value={f.police_phone} onChange={(e) => setF({ ...f, police_phone: e.target.value })} />
        </div>
        <input className="input" required minLength={3} maxLength={60} placeholder="FIR / missing-person complaint number" aria-label="FIR number" value={f.fir_ref} onChange={(e) => setF({ ...f, fir_ref: e.target.value })} />
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={confirm1} onChange={(e) => setConfirm1(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600" /> I confirm the police requested or approved this alert, and I verified it with the station by phone.</label>
        <button type="submit" className="btn w-full bg-red-600 text-white hover:bg-red-700" disabled={publish.isPending || !confirm1}>{publish.isPending ? 'Publishing…' : 'Publish alert to everyone'}</button>
        <Notice msg={msg} />
      </form>
      <div className="space-y-3">
        {(list.data ?? []).length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">No alerts.</p>}
        {(list.data ?? []).map((a) => {
          const s = (sightings.data ?? []).filter((x) => x.alert_id === a.id);
          const active = a.status === 'active' && new Date(a.expires_at) > new Date();
          return (
            <div key={a.id} className={`card space-y-2 p-4 ${active ? 'border-red-300' : 'opacity-75'}`}>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <b>{a.first_name}{a.age != null ? `, ${a.age}` : ''}</b>
                <span className={`status ${active ? 'status-closed' : a.status === 'found' ? 'status-resolved' : 'status-pending'}`}>{active ? 'Active' : a.status === 'found' ? 'Found' : a.status === 'active' ? 'Expired' : 'Cancelled'}</span>
                <span className="text-xs text-muted">FIR {a.fir_ref} · {a.police_station}</span>
              </p>
              <p className="text-xs text-muted">Last seen {a.last_seen_place} · {new Date(a.last_seen_at).toLocaleString('en-IN')} · ends {new Date(a.expires_at).toLocaleString('en-IN')}</p>
              {a.status === 'active' && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary min-h-9 px-3 text-xs" onClick={() => { if (window.confirm('Mark as found? This deletes the photo and notifies everyone.')) close.mutate({ id: a.id, status: 'found' }); }}>Child found</button>
                  <button type="button" className="btn btn-ghost min-h-9 px-3 text-xs" onClick={() => renew.mutate(a.id)}>Extend 72 h</button>
                  <button type="button" className="btn btn-danger min-h-9 px-3 text-xs" onClick={() => { if (window.confirm('Cancel this alert?')) close.mutate({ id: a.id, status: 'cancelled' }); }}>Cancel alert</button>
                </div>
              )}
              <details open={s.length > 0 && active}>
                <summary className="cursor-pointer text-xs font-semibold">Sightings ({s.length}) · pass these to the police</summary>
                <ul className="mt-2 space-y-2">
                  {s.map((x) => (
                    <li key={x.id} className="rounded-lg bg-sand p-2 text-xs">
                      <p><b>{x.place}</b> · {new Date(x.seen_at).toLocaleString('en-IN')}</p>
                      {x.note && <p>{x.note}</p>}
                      <p className="text-muted">
                        {x.lat != null && x.lng != null && <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lng}#map=17/${x.lat}/${x.lng}`}>Map</a>}
 · Caller: <b className="text-ink">{x.reporter_name}</b>, <a className="underline" href={`tel:${x.contact_phone}`}>{x.contact_phone}</a>
                        {' '}· received {timeAgo(x.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Bus routes (published timetables) ---------------- */
interface BusRouteRow { id: string; number: string; from_name: string; to_name: string; first_bus: string; last_bus: string; frequency_min: number; service: string | null; notes: string | null; active: boolean; updated_at: string }
interface EditStop { name: string; lat: number; lng: number; minutes: string; osm?: number }

export function BusRoutesAdmin() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<Msg>(null);
  const blank = { id: '', number: '', from_name: '', to_name: '', first_bus: '05:30', last_bus: '22:30', frequency_min: 15, service: 'City Ordinary', notes: '', active: true };
  const [f, setF] = useState(blank);
  const [stops, setStops] = useState<EditStop[]>([]);
  const [areaQ, setAreaQ] = useState('');
  const [found, setFound] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);

  const routes = useQuery({
    queryKey: ['admin-bus-routes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bus_routes').select('*').order('number');
      if (error) throw new Error(error.message);
      return data as BusRouteRow[];
    },
  });

  async function findStops(e: FormEvent) {
    e.preventDefault(); setSearching(true); setMsg(null);
    try {
      const places = await geocode(areaQ.trim(), new AbortController().signal);
      if (!places.length) { setFound([]); setMsg({ ok: false, text: 'Area not found. Try a landmark.' }); return; }
      const res = await busesNear(places[0].lat, places[0].lng, 900);
      setFound(res.stops);
      if (!res.stops.length) setMsg({ ok: false, text: 'No mapped stops there. Try a main road nearby.' });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setSearching(false); }
  }

  async function edit(r: BusRouteRow) {
    setMsg(null);
    setF({ id: r.id, number: r.number, from_name: r.from_name, to_name: r.to_name, first_bus: r.first_bus.slice(0, 5), last_bus: r.last_bus.slice(0, 5), frequency_min: r.frequency_min, service: r.service ?? '', notes: r.notes ?? '', active: r.active });
    const { data } = await supabase.from('bus_route_stops').select('seq, name, lat, lng, minutes_from_start, osm_node').eq('route_id', r.id).order('seq');
    setStops((data ?? []).map((s) => ({ name: s.name as string, lat: s.lat as number, lng: s.lng as number, minutes: s.minutes_from_start == null ? '' : String(s.minutes_from_start), osm: (s.osm_node as number | null) ?? undefined })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (stops.length < 2) throw new Error('Add at least 2 stops, in the order the bus visits them.');
      const row = { number: f.number.trim().toUpperCase(), from_name: f.from_name.trim(), to_name: f.to_name.trim(), first_bus: f.first_bus, last_bus: f.last_bus, frequency_min: Number(f.frequency_min), service: f.service.trim() || null, notes: f.notes.trim() || null, active: f.active };
      let id = f.id;
      if (id) {
        const { error } = await supabase.from('bus_routes').update(row).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from('bus_routes').insert(row).select('id').single();
        if (error) throw new Error(error.message);
        id = data.id as string;
      }
      const { error } = await supabase.rpc('set_route_stops', { p_route: id, p_stops: stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, minutes: s.minutes, osm: s.osm ?? '' })) });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Route saved. It now appears on the Buses page.' }); setF(blank); setStops([]); setFound([]); qc.invalidateQueries({ queryKey: ['admin-bus-routes'] }); qc.invalidateQueries({ queryKey: ['route-stops-near'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('bus_routes').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-bus-routes'] }); qc.invalidateQueries({ queryKey: ['route-stops-near'] }); },
  });

  const move = (i: number, d: -1 | 1) => setStops((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
      <form className="card space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }}>
        <h2 className="text-base font-bold">{f.id ? `Edit route ${f.number}` : 'Add a bus route'}</h2>
        <p className="text-xs text-muted">Enter routes from TGSRTC's published timetables. Times shown to citizens are the schedule, not live positions.</p>
        <div className="grid grid-cols-3 gap-2">
          <input className="input" required maxLength={12} placeholder="Number, e.g. 10H" aria-label="Route number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          <input className="input" required maxLength={80} placeholder="From" aria-label="From" value={f.from_name} onChange={(e) => setF({ ...f, from_name: e.target.value })} />
          <input className="input" required maxLength={80} placeholder="To" aria-label="To" value={f.to_name} onChange={(e) => setF({ ...f, to_name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs text-muted">First bus<input className="input mt-1" type="time" required value={f.first_bus} onChange={(e) => setF({ ...f, first_bus: e.target.value })} /></label>
          <label className="text-xs text-muted">Last bus<input className="input mt-1" type="time" required value={f.last_bus} onChange={(e) => setF({ ...f, last_bus: e.target.value })} /></label>
          <label className="text-xs text-muted">Every (min)<input className="input mt-1" type="number" min={2} max={240} required value={f.frequency_min} onChange={(e) => setF({ ...f, frequency_min: Number(e.target.value) })} /></label>
          <label className="text-xs text-muted">Service<input className="input mt-1" maxLength={40} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="Metro Express" /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-primary" /> Show to citizens</label>

        <div>
          <p className="label">Stops, in order ({stops.length})</p>
          {stops.length === 0 && <p className="text-xs text-muted">Search an area on the right and tap stops to add them.</p>}
          <ol className="space-y-1.5">
            {stops.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`} className="flex items-center gap-2 rounded-lg bg-sand px-2 py-1.5 text-sm">
                <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
                <input className="input min-h-8 flex-1 py-1 text-xs" value={s.name} aria-label={`Stop ${i + 1} name`} onChange={(e) => setStops((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input min-h-8 w-20 py-1 text-xs" type="number" min={0} max={600} placeholder="+min" title="Minutes after the bus leaves the first stop" aria-label={`Minutes to stop ${i + 1}`} value={s.minutes} onChange={(e) => setStops((all) => all.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))} />
                <button type="button" aria-label="Move up" className="px-1 text-muted hover:text-ink" onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="Move down" className="px-1 text-muted hover:text-ink" onClick={() => move(i, 1)}>↓</button>
                <button type="button" aria-label="Remove stop" className="px-1 text-muted hover:text-brick" onClick={() => setStops((all) => all.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[11px] text-muted">"+min" is how long after the first stop the bus usually reaches that stop; it makes the next-bus time accurate for each stop.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save route'}</button>
          {(f.id || stops.length > 0) && <button type="button" className="btn btn-ghost" onClick={() => { setF(blank); setStops([]); setMsg(null); }}>Cancel</button>}
        </div>
        <Notice msg={msg} />
      </form>

      <div className="space-y-4">
        <form className="card space-y-2 p-4" onSubmit={findStops}>
          <h3 className="text-sm font-bold">Find stops to add</h3>
          <div className="flex gap-2">
            <input className="input" required minLength={3} placeholder="Area or landmark, e.g. Ameerpet" aria-label="Area" value={areaQ} onChange={(e) => setAreaQ(e.target.value)} />
            <button type="submit" className="btn btn-ghost" disabled={searching}>{searching ? '…' : 'Search'}</button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {found.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setStops((all) => [...all, { name: s.name === 'Bus stop (unnamed)' ? areaQ.trim() : s.name, lat: s.lat, lng: s.lng, minutes: '', osm: s.id }])}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-primary-soft">
                  <span className="min-w-0 truncate">{s.name}</span><span className="shrink-0 text-xs text-primary">+ Add</span>
                </button>
              </li>
            ))}
          </ul>
        </form>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-bold">Routes ({routes.data?.length ?? 0})</h3>
          {routes.data?.length === 0 && <p className="text-sm text-muted">No routes yet.</p>}
          <ul className="divide-y divide-line">
            {(routes.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="inline-flex min-w-10 items-center justify-center rounded-md bg-primary px-1.5 py-0.5 text-xs font-bold text-white">{r.number}</span>
                <span className="min-w-0 flex-1 truncate">{r.from_name} → {r.to_name}{!r.active && <span className="text-muted"> (hidden)</span>}</span>
                <button type="button" className="text-xs font-semibold text-primary underline" onClick={() => void edit(r)}>Edit</button>
                <button type="button" aria-label={`Delete ${r.number}`} className="p-1 text-muted hover:text-brick" onClick={() => { if (confirm(`Delete route ${r.number}?`)) remove.mutate(r.id); }}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------------- App errors ---------------- */
interface ClientError { id: number; message: string; stack: string | null; path: string | null; release: string | null; user_agent: string | null; created_at: string }

export function ErrorsAdmin() {
  const errors = useQuery({
    queryKey: ['admin-errors'],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_errors').select('id, message, stack, path, release, user_agent, created_at').order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return data as ClientError[];
    },
  });
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">Crashes reported by people's browsers in the last 30 days. Emails, phone numbers and tokens are removed before sending.</p>
      {errors.data?.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">No errors reported. 🎉</p>}
      <ul className="space-y-2">
        {(errors.data ?? []).map((e) => (
          <li key={e.id} className="card-flat p-3 text-sm">
            <p className="font-semibold break-words">{e.message}</p>
            <p className="text-xs text-muted">{e.path} · {e.release} · {timeAgo(e.created_at)}</p>
            {e.stack && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">Details</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">{e.stack}</pre><p className="mt-1 text-muted">{e.user_agent}</p></details>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Standard replies ---------------- */
export function RepliesAdmin() {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', body: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const list = useQuery({
    queryKey: ['response-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('response_templates').select('id, title, body').order('title');
      if (error) throw new Error(error.message);
      return data as { id: string; title: string; body: string }[];
    },
  });
  const add = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('response_templates').insert({ title: f.title.trim(), body: f.body.trim() }); if (error) throw new Error(error.message); },
    onSuccess: () => { setF({ title: '', body: '' }); setMsg({ ok: true, text: 'Saved.' }); qc.invalidateQueries({ queryKey: ['response-templates'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('response_templates').delete().eq('id', id); if (error) throw new Error(error.message); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['response-templates'] }),
  });

  return (
    <section className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <form className="card space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); add.mutate(); }}>
        <h2 className="text-base font-bold">New standard reply</h2>
        <p className="text-xs text-muted">Staff can insert these when commenting on a report.</p>
        <input className="input" required minLength={2} maxLength={80} placeholder="Short name" aria-label="Name" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" required rows={3} minLength={5} maxLength={500} placeholder="Reply text" aria-label="Reply text" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <button type="submit" className="btn btn-primary w-full" disabled={add.isPending}>Save reply</button>
        <Notice msg={msg} />
      </form>
      <ul className="space-y-2">
        {(list.data ?? []).map((t) => (
          <li key={t.id} className="card-flat flex items-start justify-between gap-2 p-3 text-sm">
            <span className="min-w-0"><span className="block font-bold">{t.title}</span><span className="text-xs text-muted">{t.body}</span></span>
            <button type="button" aria-label={`Delete ${t.title}`} className="shrink-0 rounded-lg border border-line p-2 hover:bg-blush" onClick={() => { if (confirm(`Delete "${t.title}"?`)) remove.mutate(t.id); }}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
