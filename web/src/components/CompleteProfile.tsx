import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { LogOut, LocateFixed } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ACCOUNT_TYPES, isOrg, validIndianMobile, type AccountType } from '../lib/accounts';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { reverseGeocodeAddress } from '../lib/geo';

// Accounts created without the sign-up form (Google sign-in, older accounts) must add their account
// type, mobile number and address once before using the app. Guests are not asked.
export function ProfileGate({ children }: { children: React.ReactNode }) {
  const { userId, isGuest, profile } = useAuth();
  const priv = useQuery({
    queryKey: ['profile-private', userId],
    enabled: Boolean(userId) && !isGuest,
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('id, phone, address, area').eq('id', userId!).single();
      if (error) throw new Error(error.message);
      return data as { phone: string | null; address: string | null };
    },
  });
  const { pathname } = useLocation();
  const exempt = ['/privacy', '/terms', '/reset-password'].includes(pathname);
  const incomplete = Boolean(userId) && !isGuest && priv.data && (!priv.data.phone || !priv.data.address);
  if (!incomplete || !profile || exempt) return <>{children}</>;
  return <CompleteProfileForm initialType={profile.account_type ?? 'individual'} initialOrg={profile.org_name ?? ''} />;
}

function CompleteProfileForm({ initialType, initialOrg }: { initialType: AccountType; initialOrg: string }) {
  const { signOut, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<AccountType>(initialType);
  const [org, setOrg] = useState(initialOrg);
  const [phone, setPhone] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [building, setBuilding] = useState('');
  const [street, setStreet] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('Hyderabad');
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(null);
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

  const save = useMutation({
    mutationFn: async () => {
      if (!validIndianMobile(phone)) throw new Error('Please enter a valid 10-digit Indian mobile number.');
      if (!street.trim() || !area.trim() || !city.trim()) throw new Error('Please fill in at least the street, area and city.');
      if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) throw new Error('PIN code should be 6 digits.');
      if (isOrg(type) && org.trim().length < 2) throw new Error('Please enter the organisation name.');
      const { error } = await supabase.rpc('complete_my_profile', { p_account_type: type, p_org_name: isOrg(type) ? org.trim() : null, p_phone: phone.trim(), p_address: address });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile-private'] }); refreshProfile(); },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) { e.preventDefault(); setError(null); save.mutate(); }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-lg space-y-3 p-6">
      <p className="label">One more step</p>
      <h1 className="page-title">Complete your profile</h1>
      <p className="text-sm text-muted">We need these once so the city team can reach you about your reports. Your mobile number and address stay private.</p>
      <fieldset>
        <legend className="label">I am using CivicPulse as</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => {
            const { label, icon: Icon } = ACCOUNT_TYPES[k];
            return (
              <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-xs font-semibold ${type === k ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-sand'}`}>
                <input type="radio" name="cp-type" className="sr-only" checked={type === k} onChange={() => setType(k)} />
                <Icon size={16} /> {label}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted">This cannot be changed later without contacting us.</p>
      </fieldset>
      {isOrg(type) && (
        <div><label className="label" htmlFor="cp-org">{ACCOUNT_TYPES[type].orgLabel}</label><input id="cp-org" className="input" required minLength={2} maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} /></div>
      )}
      <div><label className="label" htmlFor="cp-phone">Mobile number</label><input id="cp-phone" className="input" type="tel" inputMode="tel" required autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" /></div>
      <fieldset className="space-y-2">
        <div className="flex items-center justify-between">
          <legend className="label">{isOrg(type) ? 'Office address' : 'Address'}</legend>
          <button type="button" className="btn btn-ghost text-xs" onClick={useMyLocation} disabled={locating}>
            <LocateFixed size={14} /> {locating ? 'Locating…' : 'Use my current location'}
          </button>
        </div>
        {locateNotice && <p className="text-xs text-muted">{locateNotice}</p>}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="cp-house">Flat / house no.</label>
            <input id="cp-house" className="input" maxLength={40} value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} placeholder="12-3-456" />
          </div>
          <div>
            <label className="label" htmlFor="cp-building">Building name</label>
            <input id="cp-building" className="input" maxLength={80} value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cp-street">Street</label>
          <input id="cp-street" className="input" required maxLength={120} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Road / street name" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="cp-area">Area</label>
            <input id="cp-area" className="input" required maxLength={80} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Madhapur" />
          </div>
          <div>
            <label className="label" htmlFor="cp-pincode">PIN code</label>
            <input id="cp-pincode" className="input" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} placeholder="500081" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cp-city">City</label>
          <input id="cp-city" className="input" required maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} />
          <p className="mt-1 text-[11px] text-muted">CivicPulse currently covers Hyderabad only.</p>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save and continue'}</button>
      <button type="button" className="btn btn-ghost w-full" onClick={() => signOut()}><LogOut size={15} /> Sign out instead</button>
    </form>
  );
}
