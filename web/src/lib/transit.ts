// Bus stops and TGSRTC routes from OpenStreetMap (Overpass API, free, fair use).
// OSM has stops and route numbers, and sometimes how often a route runs ("interval"), but no live
// arrival times: TGSRTC does not publish a public real-time feed. Live tracking is in its Gamyam app.

export interface Stop { id: number; name: string; lat: number; lng: number; distance: number }
export interface Route {
  id: number; ref: string; name: string; from: string | null; to: string | null;
  interval: string | null; hours: string | null; operator: string | null; stopIds: number[];
}
export interface Nearby { stops: Stop[]; routes: Route[] }

const OVERPASS = 'https://overpass-api.de/api/interpreter';

function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

type OsmEl =
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: 'relation'; id: number; tags?: Record<string, string>; members?: { type: string; ref: number; role: string }[] };

// Stops within `radius` metres and every bus route that stops at any of them.
export async function busesNear(lat: number, lng: number, radius = 700, signal?: AbortSignal): Promise<Nearby> {
  const q = `[out:json][timeout:25];
(node(around:${radius},${lat.toFixed(5)},${lng.toFixed(5)})[highway=bus_stop];
 node(around:${radius},${lat.toFixed(5)},${lng.toFixed(5)})[public_transport=platform][bus=yes];)->.s;
rel(bn.s)[route=bus]->.r;
.s out body;
.r out body;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: q }), signal });
  if (res.status === 429 || res.status === 504) throw new Error('The bus map service is busy. Please try again in a minute.');
  if (!res.ok) throw new Error('Could not load bus information right now.');
  const els = ((await res.json()) as { elements: OsmEl[] }).elements;

  const stops: Stop[] = els.filter((e): e is Extract<OsmEl, { type: 'node' }> => e.type === 'node').map((n) => ({
    id: n.id, lat: n.lat, lng: n.lon,
    name: n.tags?.name ?? n.tags?.['name:en'] ?? 'Bus stop (unnamed)',
    distance: metres(lat, lng, n.lat, n.lon),
  })).sort((a, b) => a.distance - b.distance);

  const routes: Route[] = els.filter((e): e is Extract<OsmEl, { type: 'relation' }> => e.type === 'relation').map((r) => ({
    id: r.id,
    ref: r.tags?.ref ?? '?',
    name: r.tags?.name ?? '',
    from: r.tags?.from ?? null,
    to: r.tags?.to ?? null,
    interval: r.tags?.interval ?? null,
    hours: r.tags?.opening_hours ?? null,
    operator: r.tags?.operator ?? r.tags?.network ?? null,
    stopIds: (r.members ?? []).filter((m) => m.type === 'node').map((m) => m.ref),
  })).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));

  return { stops, routes };
}

export interface DirectBus { route: Route; board: Stop; alight: Stop }

// Routes that stop near both places, in the right direction (boarding stop comes before the alighting stop).
export function directBuses(from: Nearby, to: Nearby): DirectBus[] {
  const toRoutes = new Map(to.routes.map((r) => [r.id, r]));
  const out: DirectBus[] = [];
  for (const r of from.routes) {
    if (!toRoutes.has(r.id)) continue;
    const order = new Map(r.stopIds.map((id, i) => [id, i]));
    const board = from.stops.filter((s) => order.has(s.id)).sort((a, b) => a.distance - b.distance)[0];
    const alight = to.stops.filter((s) => order.has(s.id)).sort((a, b) => a.distance - b.distance)[0];
    if (!board || !alight || board.id === alight.id) continue;
    if (order.get(board.id)! >= order.get(alight.id)!) continue;
    out.push({ route: r, board, alight });
  }
  return out.sort((a, b) => a.board.distance + a.alight.distance - (b.board.distance + b.alight.distance));
}

// "every 15 minutes" from OSM's interval tag (e.g. "00:15" or "15").
export function describeInterval(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(?:(\d{1,2}):)?(\d{1,2})(?::\d{2})?$/);
  if (!m) return `Runs: ${v}`;
  const mins = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  return mins >= 60 ? `About every ${Math.round(mins / 6) / 10} hours` : `About every ${mins} minutes`;
}

export const mapsPlace = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
export const mapsWalk = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&destination=${to.lat.toFixed(6)},${to.lng.toFixed(6)}&travelmode=walking`;
export const mapsTransit = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&destination=${to.lat.toFixed(6)},${to.lng.toFixed(6)}&travelmode=transit`;
export const osmRoute = (id: number) => `https://www.openstreetmap.org/relation/${id}`;
// Play Store search rather than a guessed app id, so the link can never point at the wrong app.
export const GAMYAM = 'https://play.google.com/store/search?q=TGSRTC%20Gamyam&c=apps';

/* ---------- Routes managed by CivicPulse admins (published timetables) ---------- */

export interface RouteStopRow {
  route_id: string; number: string; from_name: string; to_name: string; first_bus: string; last_bus: string;
  frequency_min: number; service: string | null; seq: number; stop_name: string; lat: number; lng: number;
  minutes_from_start: number | null; distance_m: number;
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const nowIstMinutes = (now = new Date()) => {
  const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return h * 60 + m;
};

export interface NextBus { label: string; inMinutes: number | null; running: boolean }

// Next scheduled departure at a stop, from first/last bus, frequency and the stop's offset along the route.
// This is the timetable, not a live position.
export function nextBus(r: Pick<RouteStopRow, 'first_bus' | 'last_bus' | 'frequency_min' | 'minutes_from_start'>, now = new Date()): NextBus {
  const offset = r.minutes_from_start ?? 0;
  const first = toMin(r.first_bus) + offset;
  let last = toMin(r.last_bus) + offset;
  if (last < first) last += 1440; // service runs past midnight
  let t = nowIstMinutes(now);
  if (t < first && t + 1440 <= last) t += 1440;
  if (t < first) return { label: `First bus at ${fmt(first)}`, inMinutes: first - t, running: false };
  if (t > last) return { label: `Service over for today. First bus ${fmt(first)}`, inMinutes: null, running: false };
  const k = Math.ceil((t - first) / r.frequency_min);
  const next = first + k * r.frequency_min;
  if (next > last) return { label: `Last bus has left. First bus ${fmt(first)}`, inMinutes: null, running: false };
  return { label: `Next around ${fmt(next)}`, inMinutes: next - t, running: true };
}

export async function routeStopsNear(lat: number, lng: number, radius = 700): Promise<RouteStopRow[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('route_stops_near', { p_lat: lat, p_lng: lng, p_radius_m: radius });
  if (error) throw new Error(error.message);
  return (data ?? []) as RouteStopRow[];
}

// Nearest stop of each route (one row per route).
export function routesAt(rows: RouteStopRow[]): RouteStopRow[] {
  const best = new Map<string, RouteStopRow>();
  for (const r of rows) if (!best.has(r.route_id) || r.distance_m < best.get(r.route_id)!.distance_m) best.set(r.route_id, r);
  return [...best.values()].sort((a, b) => a.distance_m - b.distance_m);
}

export interface DirectScheduled { board: RouteStopRow; alight: RouteStopRow }

// Admin routes that stop near both places, boarding before alighting along the route.
export function directScheduled(from: RouteStopRow[], to: RouteStopRow[]): DirectScheduled[] {
  const out: DirectScheduled[] = [];
  for (const board of routesAt(from)) {
    const alight = to.filter((s) => s.route_id === board.route_id && s.seq > board.seq).sort((a, b) => a.distance_m - b.distance_m)[0];
    if (alight) out.push({ board, alight });
  }
  return out.sort((a, b) => a.board.distance_m + a.alight.distance_m - (b.board.distance_m + b.alight.distance_m));
}

// Street address of a point, for "where exactly is this stop".
export async function addressOf(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`);
    if (!res.ok) return null;
    return ((await res.json()) as { display_name?: string }).display_name ?? null;
  } catch { return null; }
}
