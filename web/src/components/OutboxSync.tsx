import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { WifiOff, X } from 'lucide-react';
import { queuedReports } from '../lib/offline';
import { flushOutbox } from '../lib/report';

// Shows an offline banner and sends reports that were saved while offline once the connection returns.
export function OutboxSync() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState(0);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => queuedReports().then((q) => { if (alive) setWaiting(q.length); }).catch(() => {});
    const flush = async () => {
      const n = await flushOutbox((id) => { if (alive) setSent(id); }).catch(() => 0);
      if (n > 0) { qc.invalidateQueries({ queryKey: ['issues'] }); qc.invalidateQueries({ queryKey: ['issue-stats'] }); }
      refresh();
    };
    const up = () => { setOnline(true); flush(); };
    const down = () => { setOnline(false); refresh(); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    flush();
    return () => { alive = false; window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [qc]);

  return (
    <>
      {!online && (
        <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-xs font-semibold text-white">
          <WifiOff size={13} /> You are offline. Showing saved information{waiting > 0 ? ` Â· ${waiting} report${waiting > 1 ? 's' : ''} waiting to send` : ''}.
        </div>
      )}
      {sent && (
        <div role="status" className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6 lg:ps-56">
          <div className="flex items-center gap-3 rounded-full bg-navy py-2 pr-2 pl-4 text-sm text-white shadow-xl">
            Your saved report was sent.
            <Link to={`/issues/${sent}`} onClick={() => setSent(null)} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">View</Link>
            <button type="button" onClick={() => setSent(null)} aria-label="Dismiss" className="rounded-full p-1.5 hover:bg-white/15"><X size={14} /></button>
          </div>
        </div>
      )}
    </>
  );
}
