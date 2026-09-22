import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Where the feed is centred: the device's position (with permission) or a place the person searched for.
// Coordinates are kept in memory only, never stored on the device or sent to CivicPulse servers except
// as a query for nearby public reports.
export interface Centre { lat: number; lng: number; label: string; source: 'device' | 'place' }
type Permission = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported';

interface LocationValue {
  centre: Centre | null;
  permission: Permission;
  locating: boolean;
  error: string | null;
  askOnOpen: boolean;
  useDevice: () => void;
  setPlace: (c: Omit<Centre, 'source'>) => void;
  clear: () => void;
  dismissPrompt: () => void;
}

const CHOICE_KEY = 'civicpulse:location-choice'; // 'allowed' | 'later'; a preference, not coordinates
const LATER_DAYS = 14;

const Ctx = createContext<LocationValue | null>(null);

function readChoice(): { v: string; at: number } | null {
  try { return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null'); } catch { return null; }
}
function writeChoice(v: 'allowed' | 'later') {
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify({ v, at: Date.now() })); } catch { /* private mode */ }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [centre, setCentre] = useState<Centre | null>(null);
  const [permission, setPermission] = useState<Permission>(supported ? 'unknown' : 'unsupported');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const locate = useCallback(() => {
    if (!supported) { setError('This device cannot share its location. Search for your area instead.'); return; }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCentre({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Your location', source: 'device' });
        setPermission('granted');
        setLocating(false);
        writeChoice('allowed');
      },
      (e) => {
        setLocating(false);
        if (e.code === e.PERMISSION_DENIED) { setPermission('denied'); setError('Location is blocked. You can allow it in your browser settings, or search for your area.'); }
        else setError('Could not find your location. Try again or search for your area.');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60_000 },
    );
  }, [supported]);

  // On open: use the location silently if already allowed; otherwise offer our own prompt first.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const choice = readChoice();
    const snoozed = choice?.v === 'later' && Date.now() - choice.at < LATER_DAYS * 86_400_000;
    const decide = (state: PermissionState | 'unknown') => {
      if (!alive) return;
      if (state === 'granted') { setPermission('granted'); locate(); return; }
      if (state === 'denied') { setPermission('denied'); return; }
      setPermission('prompt');
      if (!snoozed) setPromptOpen(true);
    };
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((s) => {
        decide(s.state);
        s.onchange = () => { if (alive) setPermission(s.state === 'granted' ? 'granted' : s.state === 'denied' ? 'denied' : 'prompt'); };
      }, () => decide('unknown'));
    } else {
      // Safari without the Permissions API: only locate automatically if the person allowed it before.
      if (choice?.v === 'allowed') locate(); else decide('unknown');
    }
    return () => { alive = false; };
  }, [supported, locate]);

  const value = useMemo<LocationValue>(() => ({
    centre, permission, locating, error, askOnOpen: promptOpen,
    useDevice: () => { setPromptOpen(false); locate(); },
    setPlace: (c) => { setCentre({ ...c, source: 'place' }); setError(null); },
    clear: () => setCentre(null),
    dismissPrompt: () => { setPromptOpen(false); writeChoice('later'); },
  }), [centre, permission, locating, error, promptOpen, locate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation2(): LocationValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLocation2 must be used inside LocationProvider');
  return v;
}

export function formatDistance(m: number): string {
  return m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
}
