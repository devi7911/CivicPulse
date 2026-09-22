import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone, Siren } from 'lucide-react';
import { Modal } from './Modal';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { EmergencyContact } from '../lib/types';

const HOLD_MS = 1200;

type Position = { lat: number; lng: number } | null;

// SOS is honest about what it does: it places a phone call to 112 and helps the user
// share their location. It never claims that anyone has been dispatched.
export function SosButton() {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [pos, setPos] = useState<Position>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const contacts = useQuery({
    queryKey: ['emergency-contacts', userId],
    enabled: Boolean(userId) && open,
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_contacts').select('id, name, phone');
      if (error) throw new Error(error.message);
      return data as EmergencyContact[];
    },
  });

  useEffect(() => {
    if (!open) return;
    setPos(null);
    setPosError(null);
    if (!('geolocation' in navigator)) { setPosError('Location is not available on this device.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setPosError('Location permission was denied. You can still call.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [open]);

  function startHold() {
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); setOpen(true); }, HOLD_MS);
  }
  function cancelHold() {
    setHolding(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }

  const mapsLink = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : null;
  const message = `EMERGENCY: I need help.${mapsLink ? ` My location: ${mapsLink}` : ''}`;

  async function share() {
    if (navigator.share) {
      try { await navigator.share({ text: message }); } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(message);
      alert('Message copied. Paste it into any chat.');
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="SOS emergency. Press and hold."
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(true); }}
        className="fixed right-4 bottom-20 z-40 lg:right-8 lg:bottom-8 flex h-16 w-16 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-full bg-brick text-white shadow-lg shadow-brick/30 ring-4 ring-white"
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-white/30 transition-transform ease-linear"
          style={{ transform: holding ? 'scale(1)' : 'scale(0)', transitionDuration: holding ? `${HOLD_MS}ms` : '150ms' }}
        />
        <Siren size={22} className="relative" />
        <span className="relative text-[10px] font-bold tracking-widest">SOS</span>
      </button>
      {holding && (
        <div role="status" className="fixed right-4 bottom-40 z-40 lg:right-8 lg:bottom-28 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-bold shadow-hard-sm">
          Keep holding…
        </div>
      )}

      <Modal open={open} title="Emergency help" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <a href="tel:112" className="btn-danger btn w-full text-base">
            <Phone size={18} /> Call 112 now
          </a>
          <p className="text-xs text-muted">
            This places a normal phone call to the national emergency number. CivicPulse does not
            alert the police or GHMC on its own, so please make the call.
          </p>

          <div className="card-flat p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium"><MapPin size={16} /> Your location</div>
            {pos && <p className="text-muted">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p>}
            {!pos && !posError && <p className="text-muted">Finding your location…</p>}
            {posError && <p className="text-warn">{posError}</p>}
          </div>

          <button type="button" onClick={share} className="btn-ghost btn w-full">Share my location with someone</button>

          {userId && (contacts.data?.length ?? 0) > 0 && (
            <div>
              <p className="label">Your emergency contacts</p>
              <ul className="space-y-2">
                {contacts.data!.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{c.name}</span>
                    <span className="flex gap-2">
                      <a className="btn-ghost btn min-h-9 px-3" href={`tel:${c.phone}`}>Call</a>
                      <a className="btn-ghost btn min-h-9 px-3" href={`sms:${c.phone}?body=${encodeURIComponent(message)}`}>SMS</a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {userId && contacts.data?.length === 0 && (
            <p className="text-xs text-muted">Add emergency contacts in your Profile to message them from here.</p>
          )}
        </div>
      </Modal>
    </>
  );
}
