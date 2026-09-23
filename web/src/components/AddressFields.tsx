import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { reverseGeocodeAddress } from '../lib/geo';

// Shared between the sign-up form and the "complete your profile" form, so every path into the app
// asks for an address the same structured way instead of one having fields and the other a blob
// of free text. City defaults to Hyderabad since that's the only city the app covers right now.
export function useAddressFields() {
  const [houseNumber, setHouseNumber] = useState('');
  const [building, setBuilding] = useState('');
  const [street, setStreet] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('Hyderabad');
  const [pincode, setPincode] = useState('');
  const [locating, setLocating] = useState(false);
  const [locateNotice, setLocateNotice] = useState<string | null>(null);

  function useMyLocation() {
    setLocateNotice(null);
    if (!navigator.geolocation) { setLocateNotice('Location is not available in this browser — please fill in your address manually.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const parts = await reverseGeocodeAddress(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
        if (!parts) { setLocateNotice('Could not detect your address — please fill it in manually.'); return; }
        if (parts.houseNumber) setHouseNumber(parts.houseNumber);
        if (parts.building) setBuilding(parts.building);
        if (parts.street) setStreet(parts.street);
        if (parts.area) setArea(parts.area);
        if (parts.city) setCity(parts.city);
        if (parts.pincode) setPincode(parts.pincode);
        setLocateNotice('Filled in from your current location — please check it before saving.');
      },
      () => { setLocating(false); setLocateNotice('Location permission denied — please fill in your address manually.'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const address = [houseNumber, building, street, area, city, pincode].map((s) => s.trim()).filter(Boolean).join(', ');
  const valid = () => Boolean(street.trim() && area.trim() && city.trim()) && (!pincode.trim() || /^\d{6}$/.test(pincode.trim()));

  return {
    houseNumber, setHouseNumber, building, setBuilding, street, setStreet, area, setArea, city, setCity, pincode, setPincode,
    locating, locateNotice, useMyLocation, address, valid,
  };
}

export type AddressFieldsState = ReturnType<typeof useAddressFields>;

export function AddressFields({ idPrefix, label, state }: { idPrefix: string; label: string; state: AddressFieldsState }) {
  const { houseNumber, setHouseNumber, building, setBuilding, street, setStreet, area, setArea, city, setCity, pincode, setPincode, locating, locateNotice, useMyLocation } = state;
  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between">
        <legend className="label">{label}</legend>
        <button type="button" className="btn btn-ghost text-xs" onClick={useMyLocation} disabled={locating}>
          <LocateFixed size={14} /> {locating ? 'Locating…' : 'Use my current location'}
        </button>
      </div>
      {locateNotice && <p className="text-xs text-muted">{locateNotice}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${idPrefix}-house`}>Flat / house no.</label>
          <input id={`${idPrefix}-house`} className="input" maxLength={40} value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} placeholder="12-3-456" />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-building`}>Building name</label>
          <input id={`${idPrefix}-building`} className="input" maxLength={80} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-street`}>Street</label>
        <input id={`${idPrefix}-street`} className="input" required maxLength={120} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Road / street name" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${idPrefix}-area`}>Area</label>
          <input id={`${idPrefix}-area`} className="input" required maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Madhapur" />
        </div>
        <div>
          <label className="label" htmlFor={`${idPrefix}-pincode`}>PIN code</label>
          <input id={`${idPrefix}-pincode`} className="input" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} placeholder="500081" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-city`}>City</label>
        <input id={`${idPrefix}-city`} className="input" required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} />
        <p className="mt-1 text-[11px] text-muted">CivicPulse currently covers Hyderabad only.</p>
      </div>
    </fieldset>
  );
}
