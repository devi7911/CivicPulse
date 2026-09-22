import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, Baby, Bell, Bug, CalendarDays, Clock, CloudRain, Database, Download,
  ExternalLink, HandHeart, HardDrive, Hourglass, LogIn, Megaphone, MessageSquare, Minus, Printer, RefreshCw, Repeat, ShieldCheck, Smile, Ticket,
  Timer, TrendingUp, UserPlus, UserX, Users, Wallet, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ISSUE_CATEGORIES, STATUS_LABEL, timeAgo } from '../lib/constants';
import { ACCOUNT_TYPES, ORG_CHIP } from '../lib/accounts';
import type { Issue, IssueCategory, IssueStatus } from '../lib/types';
import { IssuesMap } from './IssueMap';
import { useAdminOverview } from './AdminOverview';

type Pair = [number | null, number | null];
type Kpis = Record<'reports' | 'resolved' | 'signups' | 'days_to_fix' | 'on_time' | 'satisfaction' | 'first_response_h' | 'active_people' | 'returning_pct', Pair>;
interface Dept { department: string; open: number; overdue: number; resolved: number; resolved_prev: number; avg_days: number | null; on_time: number | null; on_time_prev: number | null; rejected: number }
type Ref = { id: string; ref_no: string; title: string };

export interface Dashboard {
  from: string; to: string; days: number; kpis: Kpis;
  areas: string[];
  daily: { day: string; reported: number; resolved: number; signups: number; backlog: number }[];
  heat: [number, number, number][];
  status: Partial<Record<IssueStatus, number>> | null;
  severity_open: Partial<Record<'low' | 'medium' | 'high', number>> | null;
  category_open: Partial<Record<IssueCategory, number>> | null;
  verdicts: { accepted: number; rejected: number; waiting: number };
  map: (Pick<Issue, 'id' | 'ref_no' | 'title' | 'status' | 'lat' | 'lng' | 'category' | 'upvote_count' | 'target_date' | 'severity'> & { location_text?: string; area?: string | null })[];
  departments: Dept[];
  top_open: (Ref & { upvote_count: number; area: string | null; severity: string; assignee: string | null; age_days: number })[];
  stale_unassigned: (Ref & { area: string | null; age_days: number })[];
  due_soon: (Ref & { assignee: string | null; target_date: string })[];
  reopened: (Ref & { assignee: string | null; reopen_count: number })[];
  most_backed_week: (Ref & { new_upvotes: number })[];
  child_alerts: { id: string; first_name: string; age: number; last_seen_place: string; expires_at: string; sightings: number }[];
  city_alerts: { id: string; kind: string; severity: string; title: string; area: string | null; ends_at: string | null }[];
  engagement: { comments: number; upvotes: number; rsvps: number; contributions: number; events_upcoming: number };
  top_contributors: { id: string; display_name: string; account_type: string; org_name: string | null; verified: boolean; points: number }[];
  petitions_near: { id: string; title: string; support_count: number; threshold: number }[];
  events_watch: { id: string; title: string; starts_at: string; capacity: number | null; going: number }[];
  people: { total: number; verified: number; banned: number; by_type: Record<string, number> | null; guest_report_pct: number | null };
  verification: { requested: number; approved: number; rejected: number; pending: number; avg_review_h: number | null };
  ads: { live: number; views: number; clicks: number; paid_inr: number; unpaid: { id: string; title: string; budget_inr: number; starts_at: string }[];
    ending_soon: { id: string; title: string; ends_at: string }[]; weekly: { week: string; inr: number }[] };
  health: { errors_daily: { day: string; n: number }[]; top_errors: { message: string; n: number; last_seen: string }[]; db_bytes: number; storage_bytes: number;
    push_devices: number; push_failed_recent?: number; routes_without_stops: number };
  admins: { name: string; actions: number; last_action: string }[];
}

export interface DashFilters { days: number; from: string | null; to: string | null; area: string | null; category: string | null }

// Where staff work on tickets. Set VITE_TICKETING_URL to use an external tool; otherwise it is
// this app's own ticket queue, which asks for an admin sign-in.
const TICKETING_URL = (import.meta.env.VITE_TICKETING_URL as string | undefined)?.trim() || '/admin?tab=issues';
const TICKETING_EXTERNAL = /^https?:\/\//i.test(TICKETING_URL);

// Supabase free-tier ceilings, used for the usage bars.
const FREE_DB = 500 * 1024 * 1024;
const FREE_STORAGE = 1024 * 1024 * 1024;

const STATUS_HEX: Record<IssueStatus, string> = { pending: '#b45309', progress: '#0b5cad', resolved: '#18794e', closed: '#667085' };
const SEV_HEX = { high: '#b42318', medium: '#b45309', low: '#667085' } as const;
const fmt = (n: number | null | undefined) => (n == null ? '–' : new Intl.NumberFormat('en-IN').format(n));
const bytes = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const shortDate = (s: string) => new Date(s.length === 10 ? `${s}T12:00:00+05:30` : s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/* ---------- data ---------- */

export function useAdminDashboard(f: DashFilters, snapshot?: (f: DashFilters) => Dashboard) {
  return useQuery({
    queryKey: ['admin-dashboard', f],
    queryFn: async () => {
      if (snapshot) return snapshot(f);
      const { data, error } = await supabase.rpc('admin_dashboard', {
        p_days: f.days, p_area: f.area, p_category: f.category, p_from: f.from, p_to: f.to,
      });
      if (error) throw new Error(error.message);
      return data as Dashboard;
    },
    refetchInterval: 120_000,
    placeholderData: (prev) => prev,
  });
}

/* ---------- building blocks ---------- */

function Card({ title, icon: Icon, action, children, className = '' }: { title?: string; icon?: LucideIcon; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card flex min-w-0 flex-col p-4 break-inside-avoid ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">{Icon && <Icon size={15} className="text-muted" aria-hidden />}{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const LinkBtn = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="text-xs font-semibold text-primary hover:underline print:hidden">{children}</button>
);

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="pt-2 text-xs font-bold tracking-widest text-muted uppercase">{children}</h2>;
}

function Delta({ cur, prev, lowerIsBetter = false, unit = '' }: { cur: number | null; prev: number | null; lowerIsBetter?: boolean; unit?: string }) {
  if (cur == null || prev == null) return <span className="text-xs text-muted">no earlier data</span>;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted"><Minus size={12} /> no change</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-leaf' : 'text-brick'}`}>
      <Icon size={13} aria-hidden />{diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))}{unit} <span className="font-normal text-muted">vs previous</span>
    </span>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (v / max) * 26}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      <polyline points={`0,30 ${pts} 100,30`} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ icon: Icon, label, value, pair, lowerIsBetter, unit, spark, color, hint }: {
  icon: LucideIcon; label: string; value: string; pair: Pair; lowerIsBetter?: boolean; unit?: string; spark?: number[]; color: string; hint: string;
}) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-4 break-inside-avoid" title={hint}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Icon size={14} style={{ color }} aria-hidden />{label}</p>
      <p className="text-3xl leading-tight font-bold tabular-nums">{value}</p>
      <Delta cur={pair[0]} prev={pair[1]} lowerIsBetter={lowerIsBetter} unit={unit} />
      <p className="sr-only">{hint}</p>
      {spark && <div className="mt-auto pt-1"><Sparkline values={spark} color={color} /></div>}
    </div>
  );
}

function Bars({ rows, color = '#0b5cad' }: { rows: { label: ReactNode; key: string; value: number; sub?: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <p className="flex justify-between gap-2"><span className="min-w-0 truncate">{r.label}</span><span className="shrink-0 tabular-nums text-muted">{r.sub ?? fmt(r.value)}</span></p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full" style={{ width: `${(100 * r.value) / max}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg bg-paper p-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-xl font-bold tabular-nums ${tone === 'good' ? 'text-leaf' : tone === 'bad' ? 'text-brick' : ''}`}>{value}</dd>
    </div>
  );
}

function Usage({ label, used, limit, icon: Icon }: { label: string; used: number; limit: number; icon: LucideIcon }) {
  const pct = Math.min(100, (100 * used) / limit);
  return (
    <div>
      <p className="flex justify-between text-sm"><span className="flex items-center gap-1.5"><Icon size={14} className="text-muted" />{label}</span><span className="tabular-nums text-muted">{bytes(used)} of {bytes(limit)}</span></p>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-sand"><div className={`h-full rounded-full ${pct > 85 ? 'bg-brick' : pct > 60 ? 'bg-[#b45309]' : 'bg-leaf'}`} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
      <p className="mt-0.5 text-[11px] text-muted">{pct.toFixed(1)}% of the free plan</p>
    </div>
  );
}

/* ---------- charts ---------- */

function TrendChart({ daily, mode }: { daily: Dashboard['daily']; mode: 'activity' | 'backlog' }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 240, L = 34, B = 26, T = 10;
  const vals = mode === 'backlog' ? daily.map((d) => d.backlog) : daily.flatMap((d) => [d.reported, d.resolved, d.signups]);
  const max = Math.max(4, ...vals);
  const step = Math.ceil(max / 4), top = step * 4;
  const x = (i: number) => L + (daily.length === 1 ? (W - L) / 2 : (i / (daily.length - 1)) * (W - L - 8));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const path = (k: 'reported' | 'resolved' | 'backlog') => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[k])}`).join(' ');
  const every = Math.max(1, Math.ceil(daily.length / 8));
  const barW = Math.max(2, Math.min(10, (W - L) / daily.length / 2));
  const h = hover != null ? daily[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full" role="img" onMouseLeave={() => setHover(null)}
        aria-label={mode === 'backlog' ? 'Open reports at the end of each day' : 'Daily reports, fixes and new accounts'}>
        {[0, 1, 2, 3, 4].map((g) => (
          <g key={g}>
            <line x1={L} x2={W} y1={y(g * step)} y2={y(g * step)} className="stroke-line" strokeDasharray={g ? '3 4' : undefined} />
            <text x={L - 6} y={y(g * step) + 4} textAnchor="end" className="fill-muted text-[10px]">{g * step}</text>
          </g>
        ))}
        {mode === 'activity' ? (
          <>
            {daily.map((d, i) => d.signups > 0 && <rect key={`s${i}`} x={x(i) - barW / 2} y={y(d.signups)} width={barW} height={y(0) - y(d.signups)} rx={2} fill="#b45309" fillOpacity={0.35} />)}
            <path d={`${path('reported')} L${x(daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#0b5cad" fillOpacity={0.08} />
            <path d={path('reported')} fill="none" stroke="#0b5cad" strokeWidth={2.5} strokeLinejoin="round" />
            <path d={path('resolved')} fill="none" stroke="#18794e" strokeWidth={2.5} strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d={`${path('backlog')} L${x(daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#b42318" fillOpacity={0.1} />
            <path d={path('backlog')} fill="none" stroke="#b42318" strokeWidth={2.5} strokeLinejoin="round" />
          </>
        )}
        {daily.map((d, i) => (i % every === 0 || i === daily.length - 1) && (
          <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">{shortDate(d.day)}</text>
        ))}
        {h && hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} stroke="currentColor" strokeOpacity={0.25} />}
        {daily.map((_, i) => (
          <rect key={`h${i}`} x={x(i) - (W - L) / daily.length / 2} y={0} width={(W - L) / daily.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-2 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-md">
          <p className="font-bold">{new Date(`${h.day}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          {mode === 'activity'
            ? <><p><span className="text-primary">●</span> {h.reported} reported</p><p><span className="text-leaf">●</span> {h.resolved} resolved</p><p><span className="text-[#b45309]">■</span> {h.signups} new accounts</p></>
            : <p><span className="text-brick">●</span> {h.backlog} open at day end</p>}
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        {mode === 'activity' ? (
          <>
            <span><span className="me-1 inline-block h-0.5 w-4 bg-primary align-middle" />Reported</span>
            <span><span className="me-1 inline-block h-0.5 w-4 bg-leaf align-middle" />Resolved</span>
            <span><span className="me-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#b45309]/40 align-middle" />New accounts</span>
          </>
        ) : <span><span className="me-1 inline-block h-0.5 w-4 bg-brick align-middle" />Open reports at the end of each day. Falling is good.</span>}
      </p>
    </div>
  );
}

function Donut({ parts, center, sub }: { parts: { label: string; value: number; color: string }[]; center: string; sub: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="h-32 w-32 shrink-0" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <circle cx={55} cy={55} r={R} fill="none" className="stroke-sand" strokeWidth={14} />
        {parts.map((p) => {
          const len = (p.value / total) * C;
          const el = <circle key={p.label} cx={55} cy={55} r={R} fill="none" stroke={p.color} strokeWidth={14} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 55 55)" />;
          offset += len;
          return el;
        })}
        <text x={55} y={54} textAnchor="middle" className="fill-ink text-[20px] font-bold">{center}</text>
        <text x={55} y={70} textAnchor="middle" className="fill-muted text-[9px]">{sub}</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.label}</span>
            <span className="font-semibold tabular-nums">{p.value} <span className="font-normal text-muted">({Math.round((100 * p.value) / total)}%)</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function HeatGrid({ cells }: { cells: [number, number, number][] }) {
  const grid = new Map(cells.map(([d, h, c]) => [`${d}:${h}`, c]));
  const max = Math.max(1, ...cells.map((c) => c[2]));
  const busiest = cells.slice().sort((a, b) => b[2] - a[2])[0];
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0.5 text-[10px]" aria-label="Reports by weekday and hour">
          <thead><tr><th className="w-9" />{Array.from({ length: 24 }, (_, h) => <th key={h} className="font-normal text-muted">{h % 3 === 0 ? `${h}:00` : ''}</th>)}</tr></thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <tr key={d}>
                <th className="pe-1 text-end font-normal text-muted">{DAYS[d]}</th>
                {Array.from({ length: 24 }, (_, h) => {
                  const c = grid.get(`${d}:${h}`) ?? 0;
                  return <td key={h} title={`${DAYS[d]} ${h}:00 — ${c} report${c === 1 ? '' : 's'}`} className="h-6 rounded-sm"
                    style={{ background: c ? `rgba(11, 92, 173, ${0.15 + 0.85 * (c / max)})` : 'var(--color-sand, #f2f4f7)' }} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{busiest ? `Busiest: ${DAYS[busiest[0]]} around ${busiest[1]}:00 (${busiest[2]} reports).` : 'No reports in this period.'}</p>
    </div>
  );
}

/* ---------- export ---------- */

function toCsv(d: Dashboard, f: DashFilters): string {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows: unknown[][] = [
    ['CivicPulse admin dashboard'], ['Period', d.from, d.to], ['Area', f.area ?? 'All'], ['Category', f.category ? ISSUE_CATEGORIES[f.category as IssueCategory] : 'All'], [],
    ['Metric', 'This period', 'Previous period'],
    ...Object.entries(d.kpis).map(([k, [a, b]]) => [k.replace(/_/g, ' '), a, b]), [],
    ['Day', 'Reported', 'Resolved', 'New accounts', 'Open at day end'], ...d.daily.map((x) => [x.day, x.reported, x.resolved, x.signups, x.backlog]), [],
    ['Department', 'Open', 'Overdue', 'Resolved', 'Resolved (previous)', 'Avg days', 'On time %', 'On time % (previous)', 'Fixes rejected'],
    ...d.departments.map((x) => [x.department, x.open, x.overdue, x.resolved, x.resolved_prev, x.avg_days, x.on_time, x.on_time_prev, x.rejected]), [],
    ['Open reports by category'], ...Object.entries(d.category_open ?? {}).map(([c, n]) => [ISSUE_CATEGORIES[c as IssueCategory] ?? c, n]),
  ];
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- page ---------- */


type SortKey = 'department' | 'open' | 'overdue' | 'resolved' | 'avg_days' | 'on_time';

// `snapshot` is only for the local dev preview; the real console always loads live data.
export function AdminDashboard({ onOpen, snapshot }: { onOpen: (tab: string) => void; snapshot?: (f: DashFilters) => Dashboard }) {
  const [f, setF] = useState<DashFilters>({ days: 30, from: null, to: null, area: null, category: null });
  const [custom, setCustom] = useState(false);
  const [mode, setMode] = useState<'activity' | 'backlog'>('activity');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'open', desc: true });
  const q = useAdminDashboard(f, snapshot);
  const ov = useAdminOverview();
  const d = q.data;
  const o = ov.data;

  const depts = useMemo(() => {
    const list = [...(d?.departments ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key] ?? -1, bv = b[sort.key] ?? -1;
      const c = typeof av === 'string' ? av.localeCompare(String(bv)) : (av as number) - (bv as number);
      return sort.desc ? -c : c;
    });
    return list;
  }, [d, sort]);

  const hotspots = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of d?.map ?? []) { const a = i.area || 'No area'; m.set(a, (m.get(a) ?? 0) + 1); }
    return m;
  }, [d]);

  const th = (key: SortKey, label: string, end = true) => (
    <th className={`py-2 font-semibold ${end ? 'text-end' : 'text-start'} ${key === 'on_time' ? 'ps-4' : ''}`} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="hover:text-ink" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'department' }))}>
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="card flex flex-wrap items-end gap-3 p-3 print:hidden">
        <div>
          <p className="label mb-1">Period</p>
          <div className="inline-flex rounded-xl border border-line bg-paper p-1" role="group" aria-label="Period">
            {[7, 30, 90].map((p) => (
              <button key={p} type="button" aria-pressed={!custom && f.days === p} onClick={() => { setCustom(false); setF({ ...f, days: p, from: null, to: null }); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${!custom && f.days === p ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{p} days</button>
            ))}
            <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${custom ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>Custom</button>
          </div>
        </div>
        {custom && (
          <form className="flex items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setF({ ...f, from: String(fd.get('from')) || null, to: String(fd.get('to')) || null });
          }}>
            <div><label className="label mb-1 block" htmlFor="df">From</label><input id="df" name="from" type="date" required className="input py-1.5" defaultValue={f.from ?? ''} /></div>
            <div><label className="label mb-1 block" htmlFor="dt">To</label><input id="dt" name="to" type="date" required className="input py-1.5" defaultValue={f.to ?? ''} /></div>
            <button type="submit" className="btn btn-primary py-1.5">Apply</button>
          </form>
        )}
        <div>
          <label className="label mb-1 block" htmlFor="fa">Area</label>
          <select id="fa" className="input py-1.5" value={f.area ?? ''} onChange={(e) => setF({ ...f, area: e.target.value || null })}>
            <option value="">All areas</option>
            {(d?.areas ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="fc">Category</label>
          <select id="fc" className="input py-1.5" value={f.category ?? ''} onChange={(e) => setF({ ...f, category: e.target.value || null })}>
            <option value="">All categories</option>
            {Object.entries(ISSUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => { void q.refetch(); void ov.refetch(); }} className="btn btn-ghost py-1.5" title="Refresh now">
            <RefreshCw size={15} className={q.isFetching ? 'animate-spin' : ''} /><span className="text-xs">{q.dataUpdatedAt ? timeAgo(new Date(q.dataUpdatedAt).toISOString()) : ''}</span>
          </button>
          <button type="button" disabled={!d} onClick={() => d && download(`civicpulse-dashboard-${d.from}-to-${d.to}.csv`, toCsv(d, f))} className="btn btn-ghost py-1.5"><Download size={15} /> CSV</button>
          <button type="button" onClick={() => window.print()} className="btn btn-ghost py-1.5"><Printer size={15} /> PDF</button>
        </div>
      </div>
      {q.isError && <p role="alert" className="text-sm font-semibold text-brick">{(q.error as Error).message}</p>}

      {/* Tickets: figures only. The work itself happens in the ticketing tool. */}
      <section className="card flex flex-col gap-4 p-4 lg:flex-row lg:items-center" aria-labelledby="tickets-h">
        <div className="min-w-0 flex-1">
          <h2 id="tickets-h" className="flex items-center gap-1.5 text-sm font-bold"><Ticket size={16} className="text-primary" aria-hidden /> Tickets right now</h2>
          {!o ? <p className="mt-2 text-sm text-muted">Loading…</p> : (
            <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
              <Stat label="Open" value={fmt(o.open_issues)} />
              <Stat label="New, not started" value={fmt(o.pending_count)} />
              <Stat label="In progress" value={fmt(o.progress_count)} />
              <Stat label="Being worked on" value={fmt(o.claimed_now)} tone={o.claimed_now ? 'good' : undefined} />
              <Stat label="Nobody on it" value={fmt(Math.max(0, o.open_issues - o.claimed_now))} />
              <Stat label="Overdue" value={fmt(o.overdue)} tone={o.overdue ? 'bad' : undefined} />
              <Stat label="Due in 48 h" value={fmt(o.due_soon)} />
              <Stat label="Reopened" value={fmt(o.reopened)} tone={o.reopened ? 'bad' : undefined} />
              <Stat label="Oldest open" value={`${o.oldest_open_days} d`} />
            </dl>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 lg:w-56 print:hidden">
          <a href={TICKETING_URL} className="btn btn-primary w-full" {...(TICKETING_EXTERNAL ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            <LogIn size={16} /> Open ticketing tool{TICKETING_EXTERNAL && <ExternalLink size={14} aria-label="(opens in a new tab)" />}
          </a>
          <p className="text-center text-[11px] text-muted">Sign in there to pick up and work on tickets.</p>
        </div>
      </section>

      {!d ? <p className="text-sm text-muted">{q.isError ? 'Could not load the dashboard.' : 'Loading dashboard…'}</p> : (
        <div className={`space-y-4 transition-opacity ${q.isFetching && q.isPlaceholderData ? 'opacity-60' : ''}`}>
          <p className="text-sm text-muted">
            Showing <b className="text-ink">{shortDate(d.from)} – {shortDate(d.to)}</b> ({d.days} days), compared with the {d.days} days before
            {f.area && <> · area <b className="text-ink">{f.area}</b></>}{f.category && <> · <b className="text-ink">{ISSUE_CATEGORIES[f.category as IssueCategory]}</b></>}.
          </p>

          {/* 1. Performance */}
          <SectionTitle>Performance</SectionTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 3xl:grid-cols-9">
            <Kpi icon={TrendingUp} label="Reports" value={fmt(d.kpis.reports[0])} pair={d.kpis.reports} color="#0b5cad" spark={d.daily.map((x) => x.reported)} hint="New reports in the period." />
            <Kpi icon={ShieldCheck} label="Resolved" value={fmt(d.kpis.resolved[0])} pair={d.kpis.resolved} color="#18794e" spark={d.daily.map((x) => x.resolved)} hint="Reports marked fixed in the period." />
            <Kpi icon={Zap} label="First response" value={d.kpis.first_response_h[0] == null ? '–' : `${d.kpis.first_response_h[0]} h`} pair={d.kpis.first_response_h} lowerIsBetter unit=" h" color="#6941c6" hint="Median hours from a report arriving to its first status change." />
            <Kpi icon={Timer} label="Days to fix" value={d.kpis.days_to_fix[0] == null ? '–' : `${d.kpis.days_to_fix[0]}`} pair={d.kpis.days_to_fix} lowerIsBetter unit=" d" color="#b45309" hint="Average days from report to fix." />
            <Kpi icon={Clock} label="Fixed on time" value={d.kpis.on_time[0] == null ? '–' : `${d.kpis.on_time[0]}%`} pair={d.kpis.on_time} unit=" pts" color="#0b5cad" hint="Fixes finished by their target date." />
            <Kpi icon={Smile} label="Citizen satisfaction" value={d.kpis.satisfaction[0] == null ? '–' : `${d.kpis.satisfaction[0]}%`} pair={d.kpis.satisfaction} unit=" pts" color="#18794e" hint="Share of fixes the reporter accepted, of those they answered." />
            <Kpi icon={UserPlus} label="New accounts" value={fmt(d.kpis.signups[0])} pair={d.kpis.signups} color="#b45309" spark={d.daily.map((x) => x.signups)} hint="People who created an account." />
            <Kpi icon={Users} label="Active people" value={fmt(d.kpis.active_people[0])} pair={d.kpis.active_people} color="#6941c6" hint="People who reported, commented, upvoted or joined an event." />
            <Kpi icon={Repeat} label="Returning reporters" value={d.kpis.returning_pct[0] == null ? '–' : `${d.kpis.returning_pct[0]}%`} pair={d.kpis.returning_pct} unit=" pts" color="#0b5cad" hint="Reporters in this period who had reported before." />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title={mode === 'activity' ? 'Daily activity' : 'Backlog'} action={
              <div className="inline-flex rounded-lg border border-line p-0.5 text-xs print:hidden" role="group" aria-label="Chart">
                {(['activity', 'backlog'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-md px-2 py-1 font-semibold ${mode === m ? 'bg-primary text-white' : 'text-muted'}`}>
                    {m === 'activity' ? 'Activity' : 'Backlog'}
                  </button>
                ))}
              </div>
            }>
              <TrendChart daily={d.daily} mode={mode} />
            </Card>
            <Card title="Reports by status">
              <Donut center={fmt(Object.values(d.status ?? {}).reduce((a, b) => a + (b ?? 0), 0))} sub="reports"
                parts={(['pending', 'progress', 'resolved', 'closed'] as IssueStatus[]).map((s) => ({ label: STATUS_LABEL[s], value: d.status?.[s] ?? 0, color: STATUS_HEX[s] }))} />
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                <div>
                  <p className="mb-1.5 text-xs font-bold text-muted uppercase">Open by severity</p>
                  <div className="flex h-3 overflow-hidden rounded-full bg-sand">
                    {(['high', 'medium', 'low'] as const).map((s) => {
                      const n = d.severity_open?.[s] ?? 0, tot = Object.values(d.severity_open ?? {}).reduce((a, b) => a + (b ?? 0), 0) || 1;
                      return n ? <span key={s} style={{ width: `${(100 * n) / tot}%`, background: SEV_HEX[s] }} /> : null;
                    })}
                  </div>
                  <p className="mt-1 flex gap-3 text-xs text-muted">{(['high', 'medium', 'low'] as const).map((s) => <span key={s}><span className="me-1 inline-block h-2 w-2 rounded-full" style={{ background: SEV_HEX[s] }} />{s} {d.severity_open?.[s] ?? 0}</span>)}</p>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-bold text-muted uppercase">Citizen response to fixes</p>
                  <p className="flex flex-wrap gap-x-4 text-sm">
                    <span><b className="text-leaf">{d.verdicts.accepted}</b> accepted</span>
                    <span><b className="text-brick">{d.verdicts.rejected}</b> rejected</span>
                    <span><b>{d.verdicts.waiting}</b> awaiting reply</span>
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* 2. Where and when */}
          <SectionTitle>Where and when</SectionTitle>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title={`Open reports on the map (${d.map.length})`} className="xl:col-span-2"><IssuesMap issues={d.map as unknown as Issue[]} compact /></Card>
            <div className="space-y-4">
              <Card title="Hotspots (open reports)">
                <Bars color="#b45309" rows={[...hotspots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([a, n]) => ({ key: a, label: a, value: n }))} />
              </Card>
              <Card title="Open by category">
                <Bars rows={Object.entries(d.category_open ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([c, n]) => ({ key: c, label: ISSUE_CATEGORIES[c as IssueCategory] ?? c, value: n ?? 0 }))} />
              </Card>
            </div>
          </div>
          <Card title="When reports come in (IST)"><HeatGrid cells={d.heat} /></Card>

          {/* 3. Departments */}
          <SectionTitle>Department accountability</SectionTitle>
          <Card title="Departments" action={<Link to="/scorecard" className="text-xs font-semibold text-primary hover:underline print:hidden">Public scorecard</Link>}>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    {th('department', 'Department', false)}{th('open', 'Open')}{th('overdue', 'Overdue')}{th('resolved', 'Resolved')}{th('avg_days', 'Avg days')}
                    {th('on_time', 'On time', false)}
                    <th className="py-2 text-end font-semibold">Fixes rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {depts.map((r) => (
                    <tr key={r.department} className="border-b border-line/60 last:border-0">
                      <td className="py-2 font-semibold">{r.department}</td>
                      <td className="py-2 text-end tabular-nums">{r.open}</td>
                      <td className={`py-2 text-end tabular-nums ${r.overdue ? 'font-bold text-brick' : ''}`}>{r.overdue}</td>
                      <td className="py-2 text-end tabular-nums">{r.resolved} <Delta cur={r.resolved} prev={r.resolved_prev} /></td>
                      <td className="py-2 text-end tabular-nums">{r.avg_days ?? '–'}</td>
                      <td className="py-2 ps-4">
                        {r.on_time == null ? <span className="text-muted">–</span> : (
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-20 overflow-hidden rounded-full bg-sand"><span className={`block h-full rounded-full ${r.on_time >= 80 ? 'bg-leaf' : r.on_time >= 50 ? 'bg-[#b45309]' : 'bg-brick'}`} style={{ width: `${r.on_time}%` }} /></span>
                            <span className="tabular-nums">{r.on_time}%</span>
                            {r.on_time_prev != null && <Delta cur={r.on_time} prev={r.on_time_prev} unit=" pts" />}
                          </span>
                        )}
                      </td>
                      <td className={`py-2 text-end tabular-nums ${r.rejected ? 'font-bold text-brick' : ''}`}>{r.rejected}</td>
                    </tr>
                  ))}
                  {depts.length === 0 && <tr><td colSpan={7} className="py-3 text-muted">No reports assigned to a department in this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 5. Safety */}
          <SectionTitle>Safety</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Missing-child alerts" icon={Baby} action={<LinkBtn onClick={() => onOpen('child')}>Manage</LinkBtn>}>
              {d.child_alerts.length === 0 ? <p className="text-sm text-muted">No active alerts.</p> : (
                <ul className="space-y-2">
                  {d.child_alerts.map((a) => {
                    const soon = new Date(a.expires_at).getTime() - Date.now() < 48 * 3600e3;
                    return (
                      <li key={a.id} className="rounded-lg border border-brick/30 bg-blush p-3 text-sm">
                        <p className="font-bold text-brick">{a.first_name}, {a.age}</p>
                        <p className="text-xs">Last seen: {a.last_seen_place}</p>
                        <p className="mt-1 flex justify-between text-xs">
                          <span className={a.sightings ? 'font-bold text-brick' : 'text-muted'}>{a.sightings} sighting{a.sightings === 1 ? '' : 's'}</span>
                          <span className={soon ? 'font-bold text-brick' : 'text-muted'}>{soon ? 'Expires soon: ' : 'Expires '}{shortDate(a.expires_at)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="Live city alerts" icon={CloudRain} action={<LinkBtn onClick={() => onOpen('alerts')}>Manage</LinkBtn>}>
              {d.city_alerts.length === 0 ? <p className="text-sm text-muted">No city alerts are live.</p> : (
                <ul className="divide-y divide-line">
                  {d.city_alerts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0"><span className="block truncate font-semibold">{a.title}</span><span className="text-xs text-muted">{a.kind}{a.area ? ` · ${a.area}` : ''}</span></span>
                      <span className="shrink-0 text-xs text-muted">{a.ends_at ? `until ${shortDate(a.ends_at)}` : 'no end set'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* 6. Community */}
          <SectionTitle>Community</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <Card title="Engagement" icon={MessageSquare}>
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Comments" value={fmt(d.engagement.comments)} /><Stat label="Upvotes" value={fmt(d.engagement.upvotes)} />
                <Stat label="Event sign-ups" value={fmt(d.engagement.rsvps)} /><Stat label="Contributions" value={fmt(d.engagement.contributions)} />
                <Stat label="Upcoming events" value={fmt(d.engagement.events_upcoming)} />
              </dl>
            </Card>
            <Card title="Top contributors" icon={HandHeart}>
              {d.top_contributors.length === 0 ? <p className="text-sm text-muted">No points earned in this period.</p> : (
                <ol className="space-y-2 text-sm">
                  {d.top_contributors.map((c, i) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-4 text-xs text-muted">{i + 1}</span>
                        <span className="truncate font-semibold">{c.org_name ?? c.display_name}</span>
                        {c.verified && <BadgeCheck size={14} className="shrink-0 text-primary" aria-label="Verified" />}
                        {c.account_type !== 'individual' && ORG_CHIP[c.account_type as keyof typeof ORG_CHIP] &&
                          <span className={`shrink-0 rounded-full px-1.5 text-[10px] font-bold ${ORG_CHIP[c.account_type as keyof typeof ORG_CHIP].cls}`}>{ORG_CHIP[c.account_type as keyof typeof ORG_CHIP].label}</span>}
                      </span>
                      <b className="shrink-0 tabular-nums">{fmt(c.points)} pts</b>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Petitions close to target" icon={Megaphone} action={<LinkBtn onClick={() => onOpen('petitions')}>Manage</LinkBtn>}>
              <Bars color="#6941c6" rows={d.petitions_near.map((p) => ({ key: p.id, label: p.title, value: p.support_count, sub: `${p.support_count} / ${p.threshold}` }))} />
            </Card>
            <Card title="Events to watch" icon={CalendarDays} action={<LinkBtn onClick={() => onOpen('events')}>Manage</LinkBtn>}>
              {d.events_watch.length === 0 ? <p className="text-sm text-muted">No events are nearly full or short of sign-ups.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {d.events_watch.map((e) => {
                    const full = e.capacity != null && e.going >= 0.8 * e.capacity;
                    return (
                      <li key={e.id} className="py-2">
                        <p className="truncate font-semibold">{e.title}</p>
                        <p className="flex justify-between text-xs"><span className="text-muted">{shortDate(e.starts_at)}</span>
                          <span className={full ? 'font-bold text-[#b45309]' : 'font-bold text-brick'}>{full ? `Nearly full: ${e.going}/${e.capacity}` : `Only ${e.going} going`}</span></p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {/* 7. People and trust */}
          <SectionTitle>People and trust</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Accounts" icon={Users} action={<LinkBtn onClick={() => onOpen('people')}>Manage</LinkBtn>}>
              <dl className="mb-3 grid grid-cols-3 gap-2">
                <Stat label="Total" value={fmt(d.people.total)} /><Stat label="Verified" value={fmt(d.people.verified)} tone="good" />
                <Stat label="Banned" value={fmt(d.people.banned)} tone={d.people.banned ? 'bad' : undefined} />
              </dl>
              <Bars color="#6941c6" rows={Object.entries(d.people.by_type ?? {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ key: t, label: ACCOUNT_TYPES[t as keyof typeof ACCOUNT_TYPES]?.label ?? t, value: n }))} />
            </Card>
            <Card title="Verification" icon={BadgeCheck} action={<LinkBtn onClick={() => onOpen('verify')}>Review</LinkBtn>}>
              <ol className="space-y-2">
                {([['Requested', d.verification.requested, '#0b5cad'], ['Approved', d.verification.approved, '#18794e'], ['Rejected', d.verification.rejected, '#b42318'], ['Still waiting', d.verification.pending, '#b45309']] as const).map(([k, v, c]) => (
                  <li key={k} className="text-sm">
                    <p className="flex justify-between"><span>{k}</span><b className="tabular-nums">{v}</b></p>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full" style={{ width: `${(100 * v) / Math.max(1, d.verification.requested, d.verification.pending)}%`, background: c }} /></div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">Average review time: <b className="text-ink">{d.verification.avg_review_h == null ? '–' : `${d.verification.avg_review_h} h`}</b></p>
            </Card>
            <Card title="Guest reporting" icon={UserX}>
              <p className="text-4xl font-bold tabular-nums">{d.people.guest_report_pct == null ? '–' : `${d.people.guest_report_pct}%`}</p>
              <p className="mt-1 text-sm text-muted">of reports in this period came from people without an account. Guests are limited to 3 reports per 30 days per email, phone and device.</p>
            </Card>
          </div>

          {/* 8. Money */}
          <SectionTitle>Advertising</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Performance" icon={Megaphone} action={<LinkBtn onClick={() => onOpen('ads')}>Review ads</LinkBtn>}>
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Live campaigns" value={d.ads.live} /><Stat label="Paid this period" value={`₹${fmt(d.ads.paid_inr)}`} tone="good" />
                <Stat label="Views" value={fmt(d.ads.views)} /><Stat label="Click rate" value={d.ads.views ? `${Math.round((1000 * d.ads.clicks) / d.ads.views) / 10}%` : '–'} />
              </dl>
              <p className="mt-3 mb-1 text-xs font-bold text-muted uppercase">Paid per week</p>
              <Bars color="#18794e" rows={d.ads.weekly.map((w) => ({ key: w.week, label: `Week of ${shortDate(w.week)}`, value: w.inr, sub: `₹${fmt(w.inr)}` }))} />
            </Card>
            <Card title="Approved but unpaid" icon={Wallet}>
              {d.ads.unpaid.length === 0 ? <p className="text-sm font-semibold text-leaf">No payments to chase.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {d.ads.unpaid.map((a) => <li key={a.id} className="flex justify-between gap-2 py-2"><span className="truncate">{a.title}</span><b className="shrink-0 text-brick">₹{fmt(a.budget_inr)}</b></li>)}
                </ul>
              )}
            </Card>
            <Card title="Ending in 7 days" icon={Hourglass}>
              {d.ads.ending_soon.length === 0 ? <p className="text-sm text-muted">No campaigns end this week.</p> : (
                <ul className="divide-y divide-line text-sm">
                  {d.ads.ending_soon.map((a) => <li key={a.id} className="flex justify-between gap-2 py-2"><span className="truncate">{a.title}</span><span className="shrink-0 text-muted">{shortDate(a.ends_at)}</span></li>)}
                </ul>
              )}
            </Card>
          </div>

          {/* 9. System */}
          <SectionTitle>System health</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Free-plan usage" icon={Database}>
              <div className="space-y-4">
                <Usage label="Database" used={d.health.db_bytes} limit={FREE_DB} icon={Database} />
                <Usage label="File storage" used={d.health.storage_bytes} limit={FREE_STORAGE} icon={HardDrive} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                <Stat label="Devices with alerts on" value={fmt(d.health.push_devices)} />
                <Stat label="Failed pushes (recent)" value={d.health.push_failed_recent == null ? '–' : fmt(d.health.push_failed_recent)} tone={d.health.push_failed_recent ? 'bad' : undefined} />
              </dl>
            </Card>
            <Card title="App errors" icon={Bug} action={<LinkBtn onClick={() => onOpen('errors')}>Details</LinkBtn>}>
              <p className="text-3xl font-bold tabular-nums">{fmt(d.health.errors_daily.reduce((a, x) => a + x.n, 0))}</p>
              <p className="text-xs text-muted">in this period</p>
              <div className="my-2"><Sparkline values={d.health.errors_daily.map((x) => x.n)} color="#b42318" /></div>
              {d.health.top_errors.length > 0 && (
                <ul className="space-y-1.5 border-t border-line pt-2 text-xs">
                  {d.health.top_errors.map((e) => <li key={e.message} className="flex justify-between gap-2"><span className="truncate font-mono">{e.message}</span><b className="shrink-0">{e.n}×</b></li>)}
                </ul>
              )}
            </Card>
            <Card title="Data checks" icon={Bell}>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between"><span>Bus routes without stops</span><b className={d.health.routes_without_stops ? 'text-brick' : 'text-leaf'}>{d.health.routes_without_stops}</b></li>
                <li className="flex justify-between"><span>Reports with no map pin</span><b>{fmt(Math.max(0, (d.status?.pending ?? 0) + (d.status?.progress ?? 0) - d.map.length))}</b></li>
                <li className="flex justify-between"><span>Open reports</span><b>{fmt((d.status?.pending ?? 0) + (d.status?.progress ?? 0))}</b></li>
              </ul>
            </Card>
          </div>

          {/* 10. Admins */}
          <SectionTitle>Admin team</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Actions per admin" icon={Users}>
              {d.admins.length === 0 ? <p className="text-sm text-muted">No admin actions in this period.</p>
                : <Bars rows={d.admins.map((a) => ({ key: a.name, label: a.name, value: a.actions, sub: `${a.actions} · last ${timeAgo(a.last_action)}` }))} />}
            </Card>
            <Card title="Recent admin activity" icon={Clock} action={<LinkBtn onClick={() => onOpen('activity')}>Full log</LinkBtn>}>
              {!o?.activity.length ? <p className="text-sm text-muted">No admin actions yet. Approvals, edits and moderation will appear here.</p> : (
                <ol className="space-y-2 text-sm">
                  {o.activity.map((a, i) => (
                    <li key={i}><b>{a.actor ?? 'An admin'}</b> {a.action} {a.target_type.replace(/_/g, ' ')}{a.title ? <> · <span className="text-muted">{a.title}</span></> : null}
                      <span className="block text-xs text-muted">{timeAgo(a.created_at)}</span></li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
