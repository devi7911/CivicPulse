import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { formatDistance, useLocation2 } from '../hooks/useLocation';
import { STATUS_LABEL, isOverdue } from '../lib/constants';
import type { Issue, IssueStatus } from '../lib/types';

export const HYDERABAD: [number, number] = [17.385, 78.4867];

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const STATUS_COLOR: Record<IssueStatus, string> = { pending: '#b45309', progress: '#0b5cad', resolved: '#18794e', closed: '#475467' };

// A drawn pin avoids Leaflet's default marker images, which do not load in bundled apps.
const PIN = L.divIcon({
  className: '',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
  html: '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M14 1C7 1 1.5 6.4 1.5 13.3 1.5 22.7 14 35 14 35s12.5-12.3 12.5-21.7C26.5 6.4 21 1 14 1z" fill="#0b5cad" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>',
});

function locate(onFound: (lat: number, lng: number) => void, onError: (msg: string) => void) {
  if (!('geolocation' in navigator)) { onError('Location is not available on this device.'); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => onFound(p.coords.latitude, p.coords.longitude),
    () => onError('Could not get your location. Allow location access and try again.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function FlyTo({ to, zoom }: { to: [number, number] | null; zoom: number }) {
  const map = useMap();
  useEffect(() => { if (to) map.flyTo(to, zoom, { duration: 0.8 }); }, [map, to, zoom]);
  return null;
}

// Frames every pin once, for overview maps with no chosen centre.
function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 }); }, [map, key]);
  return null;
}

// Groups pins that would overlap on screen into one numbered bubble; tapping it zooms in.
// Recomputed on every zoom or pan, so it works for any number of reports without a plugin.
function ClusteredPins({ issues }: { issues: Issue[] }) {
  const map = useMap();
  const [, setTick] = useState(0);
  useMapEvents({ zoomend: () => setTick((t) => t + 1), moveend: () => setTick((t) => t + 1) });
  const zoom = map.getZoom();
  const cell = 56;
  const groups = new Map<string, Issue[]>();
  for (const i of issues) {
    const p = map.project([i.lat!, i.lng!], zoom);
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  return (
    <>
      {[...groups.entries()].map(([k, g]) => {
        if (g.length === 1 || zoom >= 18) {
          return g.map((i) => (
            <CircleMarker key={i.id} center={[i.lat!, i.lng!]} radius={i.severity === 'high' ? 11 : 9}
              pathOptions={{ color: '#fff', weight: 2, fillColor: STATUS_COLOR[i.status], fillOpacity: 0.95 }}>
              <Popup>
                <div className="min-w-44 space-y-1">
                  <p className="text-[11px] font-semibold text-muted">{i.ref_no} · {STATUS_LABEL[i.status]}{isOverdue(i) ? ' · Overdue' : ''}</p>
                  <p className="text-sm leading-snug font-bold">{i.title}</p>
                  <p className="text-xs text-muted">{i.distance_m != null ? `${formatDistance(i.distance_m)} · ` : ''}{i.location_text}</p>
                  <Link to={`/issues/${i.id}`} className="inline-block pt-1 text-xs font-bold text-primary">Open report</Link>
                </div>
              </Popup>
            </CircleMarker>
          ));
        }
        const lat = g.reduce((a, i) => a + i.lat!, 0) / g.length;
        const lng = g.reduce((a, i) => a + i.lng!, 0) / g.length;
        const open = g.filter((i) => i.status === 'pending' || i.status === 'progress').length;
        const size = g.length >= 50 ? 48 : g.length >= 10 ? 40 : 34;
        const icon = L.divIcon({
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${open ? '#0b5cad' : '#18794e'};color:#fff;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui,sans-serif">${g.length}</div>`,
        });
        return (
          <Marker key={k} position={[lat, lng]} icon={icon} title={`${g.length} reports here, ${open} open. Tap to zoom in.`}
            eventHandlers={{ click: () => map.fitBounds(L.latLngBounds(g.map((i) => [i.lat!, i.lng!] as [number, number])), { padding: [48, 48], maxZoom: 18 }) }} />
        );
      })}
    </>
  );
}

// Map of reports, coloured by status. Used as the third feed view. When a location or area is chosen,
// the map centres on it and draws the search radius.
export function IssuesMap({ issues, centre, radius, compact = false }: { issues: Issue[]; centre?: { lat: number; lng: number; label: string } | null; radius?: number | null; compact?: boolean }) {
  const loc = useLocation2();
  const pinned = issues.filter((i) => i.lat != null && i.lng != null);
  const here: [number, number] | null = centre ? [centre.lat, centre.lng] : null;
  const zoom = radius ? (radius <= 1000 ? 15 : radius <= 3000 ? 14 : 13) : 13;

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-line shadow-hard-sm">
        <MapContainer center={here ?? HYDERABAD} zoom={here ? zoom : 12} scrollWheelZoom={!compact} className={compact ? 'h-80 w-full lg:h-96' : 'h-[60vh] min-h-80 w-full lg:h-[70vh]'}>
          <TileLayer url={TILES} attribution={ATTRIBUTION} />
          <FlyTo to={here} zoom={zoom} />
          {here && radius && <Circle center={here} radius={radius} pathOptions={{ color: '#0b5cad', weight: 1.5, dashArray: '6 6', fillColor: '#0b5cad', fillOpacity: 0.06 }} />}
          {here && <CircleMarker center={here} radius={7} pathOptions={{ color: '#fff', weight: 3, fillColor: '#0b5cad', fillOpacity: 1 }}><Popup>{centre!.label}</Popup></CircleMarker>}
          {compact && !here && <FitAll points={pinned.map((i) => [i.lat!, i.lng!])} />}
          <ClusteredPins issues={pinned} />
        </MapContainer>
        <button type="button" onClick={loc.useDevice} disabled={loc.locating}
          className="absolute top-3 right-3 z-[500] inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-bold text-primary shadow-md hover:bg-primary-soft disabled:opacity-60">
          <LocateFixed size={15} /> {loc.locating ? 'Finding you…' : 'My location'}
        </button>
      </div>
      {loc.error && <p className="text-xs font-semibold text-brick">{loc.error}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {(Object.keys(STATUS_COLOR) as IssueStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-primary text-[8px] font-bold text-white shadow">3</span>Group: tap to zoom in</span>
        {issues.length > pinned.length && <span>{issues.length - pinned.length} report(s) have no map pin.</span>}
      </div>
    </div>
  );
}

function ClickToPin({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Map picker for the report form: tap the map, drag the pin, or use the current location.
export function LocationPicker({ value, onChange }: { value: { lat: number; lng: number } | null; onChange: (v: { lat: number; lng: number }) => void }) {
  const [fly, setFly] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow pins that come from outside the map, e.g. a location read from the photo.
  useEffect(() => { if (value) setFly([value.lat, value.lng]); }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-line">
        <MapContainer center={value ? [value.lat, value.lng] : HYDERABAD} zoom={value ? 16 : 12} className="h-64 w-full">
          <TileLayer url={TILES} attribution={ATTRIBUTION} />
          <FlyTo to={fly} zoom={16} />
          <ClickToPin onPick={(lat, lng) => onChange({ lat, lng })} />
          {value && (
            <Marker position={[value.lat, value.lng]} icon={PIN} draggable
              eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onChange({ lat: p.lat, lng: p.lng }); } }} />
          )}
        </MapContainer>
        <button type="button" disabled={busy}
          onClick={() => { setBusy(true); locate((lat, lng) => { onChange({ lat, lng }); setError(null); setBusy(false); }, (m) => { setError(m); setBusy(false); }); }}
          className="absolute top-3 right-3 z-[500] inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-bold text-primary shadow-md hover:bg-primary-soft disabled:opacity-60">
          <LocateFixed size={15} /> {busy ? 'Finding you…' : 'Use my location'}
        </button>
      </div>
      <p className="text-xs text-muted">
        {value ? `Pinned at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Drag the pin or tap the map to adjust.` : 'Tap the map where the problem is, or use your location.'}
      </p>
      {error && <p className="text-xs font-semibold text-brick">{error}</p>}
    </div>
  );
}
