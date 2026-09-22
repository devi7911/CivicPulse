import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bus, Clock, ExternalLink, Footprints, Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { PlaceSearch, geocode, type Place } from '../components/PlaceSearch';
import { formatDistance, useLocation2 } from '../hooks/useLocation';
import {
  GAMYAM, addressOf, busesNear, describeInterval, directBuses, directScheduled, mapsPlace, mapsTransit, mapsWalk, nextBus, osmRoute,
  routeStopsNear, routesAt, type Route, type Stop,
} from '../lib/transit';

// Buses near a chosen place: stops, route numbers, and whether a direct bus goes to a destination.
export function Buses() {
  const loc = useLocation2();
  const here = loc.centre;
  const [dest, setDest] = useState<Place | null>(null);

  const near = useQuery({
    queryKey: ['buses-near', here?.lat, here?.lng],
    enabled: Boolean(here),
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: ({ signal }) => busesNear(here!.lat, here!.lng, 700, signal),
  });
  const atDest = useQuery({
    queryKey: ['buses-near', dest?.lat, dest?.lng, 'dest'],
    enabled: Boolean(dest),
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: ({ signal }) => busesNear(dest!.lat, dest!.lng, 700, signal),
  });
  const direct = near.data && atDest.data ? directBuses(near.data, atDest.data) : null;
  // Routes entered by CivicPulse admins from published TGSRTC timetables.
  const sched = useQuery({
    queryKey: ['route-stops-near', here?.lat, here?.lng],
    enabled: Boolean(here),
    staleTime: 5 * 60_000,
    queryFn: () => routeStopsNear(here!.lat, here!.lng, 700),
  });
  const schedDest = useQuery({
    queryKey: ['route-stops-near', dest?.lat, dest?.lng, 'dest'],
    enabled: Boolean(dest),
    staleTime: 5 * 60_000,
    queryFn: () => routeStopsNear(dest!.lat, dest!.lng, 700),
  });
  const schedDirect = sched.data && schedDest.data ? directScheduled(sched.data, schedDest.data) : null;
  // Re-render every minute so "next around" stays current.
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 60_000); return () => window.clearInterval(t); }, []);

  return (
    <div className="space-y-5 lg:max-w-4xl">
      <div>
        <p className="label">Getting around</p>
        <h1 className="page-title flex items-center gap-2"><Bus className="text-primary" /> City <span className="marker">buses</span></h1>
        <p className="mt-1 text-sm text-muted">Find bus stops and TGSRTC route numbers near you, and check if a bus goes where you need.</p>
      </div>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">From</span>
          <PlaceSearch />
          {!here && <span className="text-xs text-muted">Choose an area or use your location to start.</span>}
        </div>
        {here && <DestinationPicker dest={dest} onPick={setDest} />}
      </section>

      <LiveTimesNote />

      {here && dest && (
        <section className="card space-y-3 p-4" aria-live="polite">
          <h2 className="flex items-center gap-2 text-base font-bold">Direct buses to {dest.label}</h2>
          {(near.isLoading || atDest.isLoading) && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Checking routes…</p>}
          {(near.isError || atDest.isError) && <p className="text-sm text-brick">{((near.error ?? atDest.error) as Error).message}</p>}
          {schedDirect && schedDirect.length > 0 && (
            <ul className="space-y-3">
              {schedDirect.map(({ board, alight }) => {
                const nb = nextBus(board);
                return (
                  <li key={board.route_id} className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex min-w-11 items-center justify-center rounded-lg bg-primary px-2 py-1 text-sm font-bold text-white">{board.number}</span>
                      <span className="min-w-0 text-sm font-semibold">{board.from_name} → {board.to_name}</span>
                      {board.service && <span className="tag">{board.service}</span>}
                    </div>
                    <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${nb.running ? 'text-leaf' : 'text-muted'}`}>
                      <Clock size={14} /> {nb.label}{nb.inMinutes != null && nb.running ? ` (in about ${nb.inMinutes} min)` : ''} · every {board.frequency_min} min
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                      <Footprints size={14} className="text-muted" /> Walk {formatDistance(board.distance_m)} to <b>{board.stop_name}</b>
                      <ArrowRight size={14} className="text-muted rtl:rotate-180" /> get off at <b>{alight.stop_name}</b>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsWalk(here, board)}><Footprints size={13} /> Walk to the stop</a>
                      <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsPlace(board.lat, board.lng)}><MapPin size={13} /> Stop on the map</a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {direct && direct.length === 0 && schedDirect && schedDirect.length === 0 && (
            <div className="space-y-2 text-sm">
              <p>No single bus route in our map data goes from near {here.label === 'Your location' ? 'you' : here.label} to near {dest.label}. You may need to change buses, or the route may not be mapped yet.</p>
              <a className="btn btn-primary" target="_blank" rel="noopener noreferrer" href={mapsTransit(here, dest)}><Navigation size={15} /> Plan the trip in Google Maps</a>
            </div>
          )}
          <ul className="space-y-3">
            {direct?.map(({ route, board, alight }) => (
              <li key={route.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <RouteBadge r={route} />
                  <span className="min-w-0 text-sm font-semibold">{route.from && route.to ? `${route.from} → ${route.to}` : route.name}</span>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                  <Footprints size={14} className="text-muted" /> Walk {formatDistance(board.distance)} to <b>{board.name}</b>
                  <ArrowRight size={14} className="text-muted rtl:rotate-180" /> get off at <b>{alight.name}</b> ({formatDistance(alight.distance)} from {dest.label})
                </p>
                {describeInterval(route.interval) && <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Clock size={12} /> {describeInterval(route.interval)}{route.hours ? ` · ${route.hours}` : ''}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsWalk(here, board)}><Footprints size={13} /> Walk to the stop</a>
                  <a className="btn btn-primary min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsTransit(board, dest)}><Navigation size={13} /> Times in Google Maps</a>
                  <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={osmRoute(route.id)}><ExternalLink size={13} /> Full route</a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {here && sched.data && sched.data.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Buses from stops near {here.label === 'Your location' ? 'you' : here.label}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {routesAt(sched.data).map((r) => {
              const nb = nextBus(r);
              return (
                <li key={r.route_id} className="card space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex min-w-11 items-center justify-center rounded-lg bg-primary px-2 py-1 text-sm font-bold text-white">{r.number}</span>
                    <span className="min-w-0 text-sm font-semibold">{r.from_name} → {r.to_name}</span>
                  </div>
                  <p className={`flex items-center gap-1.5 text-sm font-semibold ${nb.running ? 'text-leaf' : 'text-muted'}`}>
                    <Clock size={14} /> {nb.label}{nb.inMinutes != null && nb.running ? ` (in about ${nb.inMinutes} min)` : ''}
                  </p>
                  <p className="text-xs text-muted">Every {r.frequency_min} min · first {r.first_bus.slice(0, 5)}, last {r.last_bus.slice(0, 5)}{r.service ? ` · ${r.service}` : ''}</p>
                  <p className="flex items-center gap-1 text-sm"><MapPin size={14} className="text-primary" /> {r.stop_name} · {formatDistance(r.distance_m)}</p>
                  <div className="flex flex-wrap gap-2">
                    <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsWalk(here, r)}><Footprints size={13} /> Walk here</a>
                    <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsPlace(r.lat, r.lng)}><MapPin size={13} /> Open in Maps</a>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted">Times are from the published timetable, not live bus positions.</p>
        </section>
      )}

      {here && (
        <section className="space-y-3">
          <h2 className="text-base font-bold">Bus stops near {here.label === 'Your location' ? 'you' : here.label}</h2>
          {near.isLoading && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" /> Finding stops…</p>}
          {near.isError && (
            <div className="card p-4 text-sm"><p className="text-brick">{(near.error as Error).message}</p><button type="button" className="btn btn-ghost mt-2" onClick={() => void near.refetch()}>Try again</button></div>
          )}
          {near.data && near.data.stops.length === 0 && (
            <p className="card p-4 text-sm text-muted">No bus stops are mapped within 700 m. Try a nearby main road or landmark.</p>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {near.data?.stops.slice(0, 12).map((s) => <StopCard key={s.id} stop={s} routes={near.data!.routes.filter((r) => r.stopIds.includes(s.id))} from={here} />)}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-muted">Stops and routes: © OpenStreetMap contributors (Overpass API). Route data is volunteer-mapped and may be incomplete or out of date; check with TGSRTC before you travel.</p>
    </div>
  );
}

function LiveTimesNote() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft p-3 text-sm">
      <Clock size={18} className="shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        <b>Live arrival times</b> are only available in TGSRTC's own <b>Gamyam</b> app; TGSRTC does not share them publicly. Google Maps shows scheduled times where it has them.
      </p>
      <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={GAMYAM}><ExternalLink size={13} /> Get Gamyam</a>
    </div>
  );
}

function RouteBadge({ r }: { r: Route }) {
  return <span className="inline-flex min-w-11 items-center justify-center rounded-lg bg-primary px-2 py-1 text-sm font-bold text-white" title={r.operator ?? undefined}>{r.ref}</span>;
}

function StopCard({ stop, routes, from }: { stop: Stop; routes: Route[]; from: { lat: number; lng: number } }) {
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  return (
    <li className="card space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold"><MapPin size={15} className="shrink-0 text-primary" /> {stop.name}</p>
        <span className="shrink-0 text-xs font-semibold text-muted">{formatDistance(stop.distance)}</span>
      </div>
      {routes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Bus numbers">
          {routes.map((r) => (
            <a key={r.id} href={osmRoute(r.id)} target="_blank" rel="noopener noreferrer" title={r.from && r.to ? `${r.from} → ${r.to}` : r.name}
              className="inline-flex min-w-10 items-center justify-center rounded-md border border-primary/30 bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary hover:bg-primary hover:text-white">{r.ref}</a>
          ))}
        </div>
      ) : <p className="text-xs text-muted">Routes at this stop are not mapped yet.</p>}
      {address === undefined ? (
        <button type="button" className="text-xs font-semibold text-primary underline" onClick={() => { setAddress(null); void addressOf(stop.lat, stop.lng).then((a) => setAddress(a ?? '')); }}>Show address</button>
      ) : address === null ? (
        <p className="text-xs text-muted">Looking up the address…</p>
      ) : <p className="text-xs text-muted">{address || 'Address not available.'}</p>}
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsWalk(from, stop)}><Footprints size={13} /> Walk here</a>
        <a className="btn btn-ghost min-h-9 px-3 text-xs" target="_blank" rel="noopener noreferrer" href={mapsPlace(stop.lat, stop.lng)}><MapPin size={13} /> Open in Maps</a>
      </div>
    </li>
  );
}

function DestinationPicker({ dest, onPick }: { dest: Place | null; onPick: (p: Place | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setBusy(true);
      geocode(term, ctrl.signal).then(setResults).catch(() => setResults([])).finally(() => setBusy(false));
    }, 500);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q]);

  if (dest) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">To</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-primary"><MapPin size={13} /> {dest.label}</span>
        <button type="button" onClick={() => onPick(null)} aria-label="Clear destination" className="rounded-full p-1 text-muted hover:bg-sand"><X size={15} /></button>
      </p>
    );
  }
  return (
    <div className="relative">
      <label htmlFor="bus-dest" className="text-sm font-semibold">Where do you want to go? <span className="font-normal text-muted">(optional)</span></label>
      <div className="relative mt-1">
        <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
        <input id="bus-dest" className="input ps-9" placeholder="e.g. Secunderabad station, Charminar, Gachibowli" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {busy && <Loader2 size={15} className="absolute end-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-xl">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" onClick={() => { onPick(r); setQ(''); setResults([]); }} className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-start hover:bg-sand">
                <MapPin size={15} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{r.label}</span><span className="block truncate text-[11px] text-muted">{r.detail}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
