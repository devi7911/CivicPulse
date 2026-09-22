import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, Baby, Bug, Clock, Flag, Megaphone, UserX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../lib/constants';
import { InsightsAdmin } from '../pages/AdminMore';

export interface Overview {
  verify: number; flags: number; ads: number; sightings: number; petitions: number;
  overdue: number; unassigned: number; open_issues: number; reports_24h: number; resolved_7d: number;
  signups_7d: number; errors_24h: number;
  child_expiring: number; due_soon: number; reopened: number; unpaid_ads: number; routes_without_stops: number;
  claimed_now: number; pending_count: number; progress_count: number; oldest_open_days: number;
  activity: { action: string; target_type: string; title: string | null; created_at: string; actor: string | null }[];
}

export function useAdminOverview(enabled = true) {
  return useQuery({
    queryKey: ['admin-overview'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_overview');
      if (error) throw new Error(error.message);
      return data as Overview;
    },
    refetchInterval: 60_000,
  });
}

// Queue name -> which Overview count shows as its badge.
export const BADGE: Partial<Record<string, keyof Overview>> = {
  issues: 'overdue', verify: 'verify', moderation: 'flags', ads: 'ads', child: 'sightings', petitions: 'petitions', errors: 'errors_24h',
};

const ATTENTION: { key: keyof Overview; tab: string; label: string; icon: LucideIcon; urgent?: boolean }[] = [
  { key: 'sightings', tab: 'child', label: 'Child-alert sightings (48 h)', icon: Baby, urgent: true },
  { key: 'overdue', tab: 'issues', label: 'Overdue reports', icon: Clock, urgent: true },
  { key: 'unassigned', tab: 'issues', label: 'Reports with no department', icon: UserX },
  { key: 'verify', tab: 'verify', label: 'Verifications waiting', icon: BadgeCheck },
  { key: 'flags', tab: 'moderation', label: 'Flagged posts', icon: Flag },
  { key: 'ads', tab: 'ads', label: 'Ads to review', icon: Megaphone },
  { key: 'petitions', tab: 'petitions', label: 'Petitions needing a reply', icon: AlertTriangle },
  { key: 'errors_24h', tab: 'errors', label: 'App errors (24 h)', icon: Bug },
];

export function AdminOverview({ onOpen }: { onOpen: (tab: string) => void }) {
  const q = useAdminOverview();
  const d = q.data;
  if (!d) return <p className="text-sm text-muted">{q.isError ? 'Could not load the overview.' : 'Loading…'}</p>;
  const waiting = ATTENTION.filter((a) => (d[a.key] as number) > 0);

  return (
    <div className="space-y-6">
      <section aria-labelledby="ov-attn">
        <h2 id="ov-attn" className="text-lg font-semibold">Needs attention</h2>
        {waiting.length === 0
          ? <p className="card mt-2 p-4 text-sm text-leaf font-semibold">All clear. Nothing is waiting in any queue.</p>
          : (
            <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {waiting.map(({ key, tab, label, icon: Icon, urgent }) => (
                <li key={key}>
                  <button type="button" onClick={() => onOpen(tab)}
                    className={`card flex w-full items-center gap-3 p-4 text-start transition hover:border-primary ${urgent ? 'border-brick/40 bg-blush' : ''}`}>
                    <Icon size={22} className={urgent ? 'text-brick' : 'text-primary'} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-2xl font-bold">{d[key] as number}</span>
                      <span className="block text-xs text-muted">{label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="ov-today">
        <h2 id="ov-today" className="text-lg font-semibold">At a glance</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([['Open reports', d.open_issues], ['New reports, 24 h', d.reports_24h], ['Resolved, 7 days', d.resolved_7d], ['New accounts, 7 days', d.signups_7d]] as const).map(([k, v]) => (
            <div key={k} className="card flex flex-col-reverse px-4 py-3"><dt className="text-xs text-muted">{k}</dt><dd className="text-2xl font-bold">{v}</dd></div>
          ))}
        </dl>
      </section>

      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <section aria-labelledby="ov-trend">
          <h2 id="ov-trend" className="mb-2 text-lg font-semibold">Trends</h2>
          <InsightsAdmin />
        </section>
        <section aria-labelledby="ov-act">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="ov-act" className="text-lg font-semibold">Recent admin activity</h2>
            <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => onOpen('activity')}>See all</button>
          </div>
          {d.activity.length === 0
            ? <p className="text-sm text-muted">No admin actions yet.</p>
            : (
              <ol className="card divide-y divide-line">
                {d.activity.map((a, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm">
                    <span className="font-semibold">{a.actor ?? 'An admin'}</span> {a.action} {a.target_type.replace(/_/g, ' ')}
                    {a.title && <> · <span className="text-muted">{a.title}</span></>}
                    <span className="block text-xs text-muted">{timeAgo(a.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
        </section>
      </div>
    </div>
  );
}
