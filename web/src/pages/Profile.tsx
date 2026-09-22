import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BadgeCheck, Lock, LogOut, Shield, Trash2, TreePine, UserRound } from 'lucide-react';
import { PasswordCard, SaveGuestAccount } from '../components/AccountCards';
import { IssueCard } from '../components/FeedCards';
import { isOrg } from '../lib/accounts';
import { OrgChip } from '../components/OrgChip';
import { DataRightsCard, MissionsCard, PushCard, WatchAreasCard } from '../components/ProfileExtras';
import { useMyVerification, VerifyFlow } from '../components/VerifyFlow';
import { useAuth } from '../hooks/useAuth';
import { useTiers } from '../hooks/useTiers';
import { ISSUE_SELECT, timeAgo } from '../lib/constants';
import { photoUrl, supabase, uploadPhoto } from '../lib/supabase';
import { tierProgress } from '../lib/tiers';
import type { EmergencyContact, Issue, ProfilePrivate } from '../lib/types';
import { friendlyError } from '../lib/friendlyError';

interface LedgerRow { id: number; delta: number; reason: string; created_at: string }

export function Profile() {
  const { userId, profile, session, loading, isAdmin, isGuest, signOut, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const tiers = useTiers();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [form, setForm] = useState({ display_name: '', phone: '', address: '', area: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState({ name: '', phone: '' });

  const priv = useQuery({
    queryKey: ['profile-private', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('id, phone, address, area').eq('id', userId!).single();
      if (error) throw new Error(error.message);
      return data as ProfilePrivate;
    },
  });

  const ledger = useQuery({
    queryKey: ['ledger', userId, profile?.points],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('points_ledger').select('id, delta, reason, created_at').order('created_at', { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      return data as LedgerRow[];
    },
  });

  const contacts = useQuery({
    queryKey: ['emergency-contacts', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('emergency_contacts').select('id, name, phone').order('created_at');
      if (error) throw new Error(error.message);
      return data as EmergencyContact[];
    },
  });

  const verification = useMyVerification(userId);

  const myReports = useQuery({
    queryKey: ['issues', 'mine', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      // my_issues() includes the user's anonymous and confidential reports.
      const { data, error } = await supabase.rpc('my_issues').select(ISSUE_SELECT);
      if (error) throw new Error(error.message);
      return data as unknown as Issue[];
    },
  });

  useEffect(() => {
    if (profile && priv.data) {
      setForm({ display_name: profile.display_name, phone: priv.data.phone ?? '', address: priv.data.address ?? '', area: priv.data.area ?? '' });
    }
  }, [profile, priv.data]);

  const save = useMutation({
    mutationFn: async () => {
      const a = await supabase.from('profiles').update({ display_name: form.display_name.trim() }).eq('id', userId!);
      if (a.error) throw new Error(a.error.message);
      const b = await supabase.from('profile_private').update({
        phone: form.phone.trim() || null, address: form.address.trim() || null, area: form.area.trim() || null,
      }).eq('id', userId!);
      if (b.error) throw new Error(b.error.message.includes('phone') ? 'Please enter a valid phone number (10 to 13 digits).' : b.error.message);
    },
    onSuccess: () => { setSaved(true); setError(null); refreshProfile(); qc.invalidateQueries({ queryKey: ['profile-private'] }); qc.invalidateQueries({ queryKey: ['my-area'] }); },
    onError: (e: Error) => { setSaved(false); setError(e.message); },
  });

  const addContact = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('emergency_contacts').insert({ user_id: userId!, name: contact.name.trim(), phone: contact.phone.trim() });
      if (error) throw new Error(error.message.includes('phone') ? 'Please enter a valid phone number.' : error.message);
    },
    onSuccess: () => { setContact({ name: '', phone: '' }); setError(null); qc.invalidateQueries({ queryKey: ['emergency-contacts'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const removeContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emergency-contacts'] }),
  });

  const setAvatar = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadPhoto(userId!, file);
      const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: refreshProfile,
    onError: (e: Error) => setError(e.message),
  });

  if (!loading && !userId) return <Navigate to="/auth" replace />;
  if (loading || !profile) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;

  const progress = tiers.data ? tierProgress(tiers.data, profile.points) : null;
  const avatar = photoUrl(profile.avatar_path);

  function onSave(e: FormEvent) { e.preventDefault(); setSaved(false); save.mutate(); }
  function onAddContact(e: FormEvent) { e.preventDefault(); addContact.mutate(); }

  return (
    <div className="stagger space-y-5 lg:columns-2 3xl:columns-3 lg:gap-5 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-5">
      <section className="card flex items-center gap-4 p-4">
        {profile.verified ? (
          <label className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-sand" title="Change profile picture">
            {avatar ? <img src={avatar} alt="Your profile" className="h-full w-full object-cover" /> : <UserRound className="m-auto mt-4 text-muted" size={32} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAvatar.mutate(f); }} />
          </label>
        ) : (
          <button type="button" onClick={() => setVerifyOpen(true)} aria-label="Profile picture is locked. Get verified to unlock."
            className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-line bg-sand text-muted">
            <UserRound size={32} className="opacity-40" />
            <span className="absolute -right-1 -bottom-1 rounded-full border-2 border-white bg-primary p-1 text-white"><Lock size={12} /></span>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 truncate text-2xl font-semibold">
            {profile.display_name}
            {profile.verified && <BadgeCheck size={18} className="shrink-0 text-brand" aria-label="Verified" />}
          </h1>
          <p className="truncate text-xs text-muted">{isGuest ? 'Guest, no email yet' : session?.user.email}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            <span className={profile.verified ? 'stamp text-primary' : 'stamp text-muted'}>{profile.verified ? 'Verified' : 'Not verified'}</span>
            <OrgChip type={profile.account_type} verified={profile.verified} />
            {profile.org_name && <span className="stamp text-ink">{profile.org_name}</span>}
          </p>
        </div>
      </section>

      {isGuest && <SaveGuestAccount />}

      {!profile.verified && !isGuest && (
        <section className="card bg-primary-soft p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Shield size={18} /> Get verified</h2>
          <p className="mt-1 text-sm text-ink/75">Verified accounts get a badge, can add a profile picture and can share contributions with the community. Use your masked Aadhaar (last 4 digits only) or another government ID{isOrg(profile.account_type) ? ', or your organisation\'s registration certificate' : ''}.</p>
          <button type="button" className="btn btn-dark mt-3 w-full" onClick={() => setVerifyOpen(true)}>{verification.data?.status === 'pending' ? 'Review in progress · view status' : 'Start verification'}</button>
        </section>
      )}

      {progress && (
        <section aria-labelledby="ach-h" className="card space-y-3 p-4">
          <h2 id="ach-h" className="flex items-center gap-2 text-lg font-semibold"><Award size={18} className="text-amber" /> Civic achievements</h2>
          <div className="flex items-end justify-between">
            <div><p className="text-5xl leading-none tracking-tight font-semibold">{profile.points}</p><p className="label mt-1 mb-0">points earned</p></div>
            <p className="stamp text-ink">{progress.current.title}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} /></div>
          <p className="text-xs text-muted">{progress.next ? `${progress.pointsToNext} more points to reach ${progress.next.name}` : 'You have reached the highest tier.'}</p>
          <div className="flex gap-3 rounded-xl border border-line bg-[#e7f6ec] p-3 text-sm">
            <TreePine size={18} className="mt-0.5 shrink-0 text-ok" />
            <p><span className="font-semibold">Community impact.</span> As a {progress.current.title}: {progress.current.community_reward}</p>
          </div>
          {(ledger.data?.length ?? 0) > 0 && (
            <ul className="divide-y divide-line text-xs">
              {ledger.data!.map((r) => (
                <li key={r.id} className="flex justify-between py-1.5">
                  <span className="text-muted">{r.reason} · {timeAgo(r.created_at)}</span>
                  <span className={r.delta >= 0 ? 'font-semibold text-ok' : 'font-semibold text-danger'}>{r.delta > 0 ? '+' : ''}{r.delta}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isGuest && <MissionsCard />}
      {!isGuest && <PushCard userId={userId!} />}
      {!isGuest && <WatchAreasCard userId={userId!} />}
      {!isGuest && <PasswordCard />}
      {!isGuest && <DataRightsCard />}

      <form onSubmit={onSave} className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">Your details</h2>
        <div><label className="label" htmlFor="dn">Name</label><input id="dn" className="input" required minLength={2} maxLength={60} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
        <div><label className="label" htmlFor="ph">Phone number</label><input id="ph" className="input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919876543210" /></div>
        <div><label className="label" htmlFor="ar">Area or locality</label><input id="ar" className="input" maxLength={80} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Madhapur" /></div>
        <div><label className="label" htmlFor="ad">Address</label><textarea id="ad" className="input" rows={2} maxLength={300} autoComplete="street-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <p className="text-[11px] text-muted">Your phone, area and address are private. Only you can see them.</p>
        <button type="submit" className="btn-primary btn w-full" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save details'}</button>
        {saved && <p role="status" className="text-sm text-ok">Saved.</p>}
      </form>

      {!isGuest && <section className="card space-y-3 p-4">
        <h2 className="text-lg font-semibold">Emergency contacts</h2>
        <p className="text-xs text-muted">Up to 3 people you can call or message quickly from the SOS button.</p>
        <ul className="space-y-2">
          {(contacts.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{c.name} <span className="text-muted">· {c.phone}</span></span>
              <button type="button" aria-label={`Remove ${c.name}`} className="rounded-lg p-2 text-muted hover:text-danger" onClick={() => removeContact.mutate(c.id)}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
        {(contacts.data?.length ?? 0) < 3 && (
          <form onSubmit={onAddContact} className="grid grid-cols-2 gap-2">
            <input aria-label="Contact name" className="input" required maxLength={60} placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            <input aria-label="Contact phone" className="input" required type="tel" inputMode="tel" placeholder="+919876543210" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            <button type="submit" className="btn-ghost btn col-span-2" disabled={addContact.isPending}>Add contact</button>
          </form>
        )}
      </section>}

      {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}

      <section aria-labelledby="mine-h" className="space-y-3 lg:[column-span:all]">
        <h2 id="mine-h" className="text-lg font-semibold">My reports ({myReports.data?.length ?? 0})</h2>
        {myReports.data?.length === 0 && (
          <div className="card-flat border-dashed p-5 text-center text-sm text-muted">
            You have not reported anything yet. <Link to="/report" className="font-semibold text-primary underline">Report your first issue</Link>
          </div>
        )}
        <div className="space-y-4">{(myReports.data ?? []).map((it) => <IssueCard key={it.id} issue={it} />)}</div>
      </section>

      {isAdmin && <Link to="/admin" className="btn-ghost btn w-full lg:hidden"><Shield size={16} /> Open admin console</Link>}
      <button type="button" className="btn-ghost btn w-full lg:hidden" onClick={() => signOut()}><LogOut size={16} /> Sign out</button>
      <p className="flex justify-center gap-4 text-xs text-muted lg:hidden"><Link to="/privacy" className="underline">Privacy</Link><Link to="/terms" className="underline">Terms</Link><Link to="/open-data" className="underline">Open data</Link><Link to="/advertise" className="underline">Advertise</Link></p>

      <VerifyFlow userId={userId!} open={verifyOpen} onClose={() => setVerifyOpen(false)} />
    </div>
  );
}
