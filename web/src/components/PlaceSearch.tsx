import { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { useLocation2 } from '../hooks/useLocation';
import { useT } from '../lib/i18n';

export interface Place { lat: number; lng: number; label: string; detail: string }

// Area search using OpenStreetMap Nominatim (free; its policy allows light, human-driven use with
// at most one request per second). Results are biased to Hyderabad and limited to India.
const HYD_BOX = '78.20,17.60,78.70,17.20';
let lastCall = 0;

export async function geocode(q: string, signal: AbortSignal): Promise<Place[]> {
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&viewbox=${HYD_BOX}&accept-language=en&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Place search is busy. Please try again in a moment.');
  const rows = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
  return rows.map((r) => {
    const parts = r.display_name.split(', ');
    return { lat: Number(r.lat), lng: Number(r.lon), label: r.name || parts[0], detail: parts.slice(1, 4).join(', ') };
  });
}

export function PlaceSearch({ onPicked }: { onPicked?: () => void }) {
  const loc = useLocation2();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setBusy(true); setError(null);
      geocode(term, ctrl.signal).then(setResults).catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); }).finally(() => setBusy(false));
    }, 500);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function pick(p: Place) {
    loc.setPlace({ lat: p.lat, lng: p.lng, label: p.label });
    setOpen(false); setQ(''); setResults([]);
    onPicked?.();
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex min-h-9 max-w-[14rem] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${loc.centre ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-card text-ink hover:bg-sand'}`}>
        <MapPin size={14} className="shrink-0" />
        <span className="truncate">{loc.centre ? t('area.near', { x: loc.centre.label }) : t('area.choose')}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-line bg-card p-3 shadow-xl">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input autoFocus className="input pr-9 pl-9" placeholder="Area, street or landmark" aria-label="Search for an area" value={q} onChange={(e) => setQ(e.target.value)} />
            {busy && <Loader2 size={15} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-muted" />}
          </div>
          <button type="button" onClick={() => { loc.useDevice(); setOpen(false); onPicked?.(); }} disabled={loc.locating}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold text-primary hover:bg-primary-soft">
            <Crosshair size={16} /> {loc.locating ? 'Finding you…' : 'Use my current location'}
          </button>
          {loc.permission === 'denied' && <p className="px-2 text-[11px] text-muted">Location is blocked in this browser. Search for your area instead.</p>}
          {error && <p className="px-2 text-xs text-brick">{error}</p>}
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto border-t border-line pt-1">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button type="button" onClick={() => pick(r)} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-sand">
                    <MapPin size={15} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{r.label}</span><span className="block truncate text-[11px] text-muted">{r.detail}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 3 && !busy && !error && results.length === 0 && <p className="px-2 text-xs text-muted">No places found. Try a nearby landmark.</p>}
          {loc.centre && (
            <button type="button" onClick={() => { loc.clear(); setOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted hover:bg-sand">
              <X size={14} /> Show the whole city instead
            </button>
          )}
          <p className="px-2 text-[10px] text-muted">Place search by © OpenStreetMap contributors (Nominatim).</p>
        </div>
      )}
    </div>
  );
}
