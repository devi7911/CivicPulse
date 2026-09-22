import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { DepartmentScore } from '../lib/types';

const pct = (v: number | null) => (v == null ? 'n/a' : `${v}%`);

// Public accountability page: how each department handles the reports assigned to it.
export function Scorecard() {
  const board = useQuery({
    queryKey: ['scorecard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('department_scorecard');
      if (error) throw new Error(error.message);
      return data as DepartmentScore[];
    },
  });

  const rows = board.data ?? [];
  const totals = rows.reduce((a, r) => ({ open: a.open + r.open, overdue: a.overdue + r.overdue, resolved: a.resolved + r.resolved }), { open: 0, overdue: 0, resolved: 0 });

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Public accountability</p>
        <h1 className="page-title">Department <span className="marker">scorecard</span></h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          How each department handles the reports assigned to it on CivicPulse. Departments with overdue work are listed first.
          A fix counts as confirmed when the reporter accepts it, or does not object within 7 days.
        </p>
        <Link to="/open-data" className="mt-1 inline-flex min-h-9 items-center text-sm font-semibold text-primary hover:underline">Download the raw data</Link>
      </div>

      <dl className="grid grid-cols-3 gap-3 sm:max-w-xl">
        {([['Open', totals.open, 'text-ink'], ['Overdue', totals.overdue, 'text-brick'], ['Resolved', totals.resolved, 'text-leaf']] as const).map(([k, v, c]) => (
          <div key={k} className="card flex flex-col-reverse px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={`text-2xl font-bold ${c}`}>{v}</dd>
          </div>
        ))}
      </dl>

      {board.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {board.isError && <p className="text-sm font-semibold text-brick">Could not load the scorecard.</p>}
      {!board.isLoading && rows.length === 0 && <p className="card px-6 py-10 text-center text-sm text-muted">No reports have been assigned to a department yet.</p>}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-line bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Department</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 text-right font-semibold">Open</th>
                <th className="px-3 py-3 text-right font-semibold">Overdue</th>
                <th className="px-3 py-3 text-right font-semibold">Avg days to fix</th>
                <th className="px-3 py-3 text-right font-semibold">On time</th>
                <th className="px-3 py-3 text-right font-semibold">Fix confirmed</th>
                <th className="px-3 py-3 text-right font-semibold">Reopened</th>
                <th className="px-4 py-3 text-right font-semibold">Closed, not fixed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.department}>
                  <th scope="row" className="px-4 py-3 text-left font-semibold">{r.department}</th>
                  <td className="px-3 py-3 text-right">{r.total}</td>
                  <td className="px-3 py-3 text-right">{r.open}</td>
                  <td className={`px-3 py-3 text-right ${r.overdue > 0 ? 'font-bold text-brick' : ''}`}>{r.overdue}</td>
                  <td className="px-3 py-3 text-right">{r.avg_days_to_fix ?? 'n/a'}</td>
                  <td className="px-3 py-3 text-right">{pct(r.on_time_pct)}</td>
                  <td className="px-3 py-3 text-right">{pct(r.confirmed_pct)}</td>
                  <td className="px-3 py-3 text-right">{r.reopened}</td>
                  <td className="px-4 py-3 text-right">{r.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
