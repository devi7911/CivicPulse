import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ACCOUNT_TYPES, isOrg, validIndianMobile, type AccountType } from '../lib/accounts';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { AddressFields, useAddressFields } from './AddressFields';

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
  const addr = useAddressFields();
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!validIndianMobile(phone)) throw new Error('Please enter a valid 10-digit Indian mobile number.');
      if (!addr.valid()) throw new Error('Please fill in at least the street, area and city, and a 6-digit PIN code if given.');
      if (isOrg(type) && org.trim().length < 2) throw new Error('Please enter the organisation name.');
      const { error } = await supabase.rpc('complete_my_profile', { p_account_type: type, p_org_name: isOrg(type) ? org.trim() : null, p_phone: phone.trim(), p_address: addr.address });
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
      <AddressFields idPrefix="cp" label={isOrg(type) ? 'Office address' : 'Address'} state={addr} />
      {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save and continue'}</button>
      <button type="button" className="btn btn-ghost w-full" onClick={() => signOut()}><LogOut size={15} /> Sign out instead</button>
    </form>
  );
}
