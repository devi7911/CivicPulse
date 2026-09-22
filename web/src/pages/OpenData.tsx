import { useState } from 'react';
import { Database, Download } from 'lucide-react';
import { toCsv } from '../lib/csv';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';

// Only public, non-personal columns. Anonymous and confidential rules are enforced by the database policies.
const COLS = 'ref_no, category, status, location_text, lat, lng, upvote_count, comment_count, assignee, created_at, target_date, resolved_at, closed_reason, reopen_count';


export function OpenData() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: 'csv' | 'json') {
    setBusy(format); setError(null);
    try {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('issues').select(COLS).eq('confidential', false).order('created_at').range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data as Record<string, unknown>[]));
        if (!data || data.length < 1000 || rows.length >= 20000) break;
      }
      // Round coordinates to about 100 m so exact doorsteps are not published.
      for (const r of rows) {
        if (typeof r.lat === 'number') r.lat = Math.round(r.lat * 1000) / 1000;
        if (typeof r.lng === 'number') r.lng = Math.round(r.lng * 1000) / 1000;
      }
      const text = format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `civicpulse-reports-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  return (
    <div className="space-y-5 lg:max-w-3xl">
      <div>
        <p className="label">Transparency</p>
        <h1 className="page-title">Open <span className="marker">data</span></h1>
        <p className="mt-1 text-sm text-muted">Download every public report for research, journalism or planning. Free to reuse under CC BY 4.0, credit "CivicPulse".</p>
      </div>
      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Database size={18} /> All public reports</h2>
        <p className="text-sm text-muted">Includes reference number, category, status, area, rough location, support count, department, promised and actual fix dates.</p>
        <p className="rounded-xl bg-sand p-3 text-xs">Never included: names, emails, phone numbers, descriptions, photos or confidential reports. Locations are rounded to about 100 metres.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => download('csv')}><Download size={16} /> {busy === 'csv' ? 'Preparing…' : 'Download CSV'}</button>
          <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => download('json')}><Download size={16} /> {busy === 'json' ? 'Preparing…' : 'Download JSON'}</button>
        </div>
        {error && <p role="alert" className="text-sm text-brick">{friendlyError(error)}</p>}
      </section>
    </div>
  );
}
