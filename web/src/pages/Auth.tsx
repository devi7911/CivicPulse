import { useCallback, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { Captcha, captchaEnabled, getCaptchaToken } from '../components/Captcha';
import { AddressFields, useAddressFields } from '../components/AddressFields';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { ACCOUNT_TYPES, isOrg, validIndianMobile, type AccountType } from '../lib/accounts';
import { friendlyError } from '../lib/friendlyError';

const GOOGLE_ENABLED = import.meta.env.VITE_AUTH_GOOGLE === 'true';

export function Auth() {
  const { userId, isGuest } = useAuth();
  const location = useLocation();
  // Default to Sign in, whatever the visitor's guest status — a "Sign in" link should not land on
  // Create account just because they happen to have an anonymous session. Only links that
  // specifically say "Create an account" pass state to open on that tab instead.
  const modeFromState = (location.state as { mode?: 'signin' | 'signup' } | null)?.mode;
  const [mode, setMode] = useState<'signin' | 'signup'>(modeFromState ?? 'signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const addr = useAddressFields();
  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set once sign-up succeeds and needs an email confirmation; replaces the whole form so there is
  // nothing left to edit or re-submit while the person goes to check their inbox.
  const [confirming, setConfirming] = useState<{ email: string; guestUpgrade: boolean } | null>(null);
  const [resent, setResent] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaOk, setCaptchaOk] = useState(false);
  const onCaptcha = useCallback((t: string | null) => setCaptchaOk(Boolean(t)), []);

  if (userId && !isGuest) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;

  if (confirming) {
    return (
      <div className="stagger card mx-auto max-w-md space-y-4 p-6 text-center sm:p-8">
        <Mail size={40} className="mx-auto text-primary" />
        <div>
          <h1 className="page-title">Check your email</h1>
          <p className="mt-2 text-sm text-muted">
            We sent a confirmation link to <span className="font-semibold text-ink">{confirming.email}</span>.
            {confirming.guestUpgrade
              ? ' Open it, then come back here and set a password in your Profile. The reports you tracked on this device will stay with you.'
              : ' Open it on this device, then come back here and sign in.'}
          </p>
        </div>
        <p className="text-xs text-muted">Not there yet? Check your spam folder, or the address for a typo.</p>
        {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
        {resent ? (
          <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ok"><MailCheck size={16} /> Sent again.</p>
        ) : (
          <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={resendConfirmation}>{busy ? 'Sending…' : 'Send the link again'}</button>
        )}
        <button type="button" className="btn btn-primary w-full" onClick={() => { setConfirming(null); setResent(false); setMode('signin'); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  // Google sign-in: the client ID and secret live only in Supabase > Authentication > Providers > Google.
  async function google() {
    setError(null);
    setBusy(true);
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${from.startsWith('/') ? from : '/'}` },
    });
    if (error) { setError('Google sign-in is not available right now. Please use email.'); setBusy(false); }
  }

  async function forgot() {
    setError(null);
    setNotice(null);
    if (!email.trim()) { setError('Enter your email above first, then tap "Forgot password".'); return; }
    if (captchaEnabled && !getCaptchaToken()) { setError('Please complete the security check first.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password`, captchaToken: getCaptchaToken() ?? undefined });
    setCaptchaKey((k) => k + 1);
    // Same message either way, so this screen cannot be used to find out who has an account.
    if (error && error.status === 429) setError('Too many attempts. Please wait a few minutes.');
    else setNotice('If an account exists for that email, a reset link is on its way.');
  }

  async function resendConfirmation() {
    if (!confirming) return;
    setError(null);
    setBusy(true);
    const { error } = confirming.guestUpgrade
      ? await supabase.auth.resend({ type: 'email_change', email: confirming.email })
      : await supabase.auth.resend({ type: 'signup', email: confirming.email });
    setBusy(false);
    if (error) setError(error.message);
    else setResent(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === 'signup') {
      if (!validIndianMobile(phone)) { setError('Please enter a valid 10-digit Indian mobile number.'); return; }
      if (!addr.valid()) { setError('Please fill in at least the street, area and city, and a 6-digit PIN code if given.'); return; }
      if (isOrg(accountType) && orgName.trim().length < 2) { setError(`Please enter the ${ACCOUNT_TYPES[accountType].orgLabel?.toLowerCase()}.`); return; }
    }
    setBusy(true);
    // Stored privately by the database when the account is created (phone and address are never public).
    const profileData = {
      display_name: name.trim(), phone: phone.trim(), address: addr.address, account_type: accountType,
      org_name: isOrg(accountType) ? orgName.trim() : null,
    };
    if (mode === 'signup' && isGuest) {
      // Turn this device's guest into a real account, so the reports it tracked come along.
      const { error } = await supabase.auth.updateUser(
        { email: email.trim(), data: profileData },
        { emailRedirectTo: `${window.location.origin}/profile` },
      );
      if (error) setError(error.message.toLowerCase().includes('already') ? 'That email already has an account. Use Sign in instead.' : error.message);
      else setConfirming({ email: email.trim(), guestUpgrade: true });
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: profileData, emailRedirectTo: window.location.origin, captchaToken: getCaptchaToken() ?? undefined },
      });
      if (error) setError(error.message);
      else if (!data.session) setConfirming({ email: email.trim(), guestUpgrade: false });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken: getCaptchaToken() ?? undefined } });
      if (error) setError(error.message.toLowerCase().includes('captcha') ? 'The security check expired. Please try again.' : 'Incorrect email or password.');
    }
    // Tokens are single use: show a fresh check for the next attempt.
    setCaptchaKey((k) => k + 1);
    setBusy(false);
  }

  return (
    <div className="stagger card mx-auto max-w-md space-y-5 p-6 sm:p-8">
      {isGuest && (
        <div className="rounded-xl bg-primary-soft p-3 text-xs text-primary">
          <p className="font-bold">You are tracking reports on this device as a guest.</p>
          <p className="mt-0.5">Create account keeps those reports and adds them to your new account. Signing in to an existing account leaves them behind on this device.</p>
        </div>
      )}
      <div className="text-center">
        <h1 className="page-title">{mode === 'signin' ? 'Welcome back' : 'Join CivicPulse'}</h1>
        <p className="mt-1 text-sm text-muted">Report issues, join events and earn rewards for your community.</p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-sand p-1" role="tablist">
        {(['signin', 'signup'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); setNotice(null); }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${mode === m ? 'bg-primary text-white' : 'text-muted'}`}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {GOOGLE_ENABLED && !isGuest && (
        <div className="space-y-2">
          <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={google}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.7 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.6-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.1 7.1l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4z"/></svg>
            Continue with Google
          </button>
          <p className="text-center text-[11px] text-muted">By continuing you accept the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.</p>
          <p className="flex items-center gap-3 text-[11px] text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">or use email</p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && (
          <>
            <fieldset>
              <legend className="label">I am signing up as</legend>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => {
                  const { label, hint, icon: Icon } = ACCOUNT_TYPES[k];
                  return (
                    <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-xs transition ${accountType === k ? 'border-primary bg-primary-soft' : 'border-line hover:bg-sand'}`}>
                      <input type="radio" name="account-type" value={k} checked={accountType === k} onChange={() => setAccountType(k)} className="sr-only" />
                      <Icon size={17} className={`mt-0.5 shrink-0 ${accountType === k ? 'text-primary' : 'text-muted'}`} />
                      <span><span className="block font-semibold text-ink">{label}</span><span className="text-muted">{hint}</span></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {isOrg(accountType) && (
              <div><label className="label" htmlFor="org">{ACCOUNT_TYPES[accountType].orgLabel}</label><input id="org" className="input" required minLength={2} maxLength={100} autoComplete="organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></div>
            )}
            <div><label className="label" htmlFor="name">{isOrg(accountType) ? 'Contact person name' : 'Your name'}</label><input id="name" className="input" required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="label" htmlFor="phone">Mobile number</label><input id="phone" className="input" type="tel" inputMode="tel" required autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <AddressFields idPrefix="su" label={isOrg(accountType) ? 'Office address' : 'Address'} state={addr} />
          </>
        )}
        <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {mode === 'signup' && isGuest ? (
          <p className="text-[11px] text-muted">We will email you a confirmation link. You will set a password after confirming.</p>
        ) : (
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" required minLength={mode === 'signup' ? 10 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'signup' && <p className="mt-1 text-[11px] text-muted">At least 10 characters.</p>}
          {mode === 'signin' && <button type="button" onClick={forgot} className="mt-1 inline-flex min-h-10 items-center text-xs font-semibold text-primary underline">Forgot password?</button>}
        </div>
        )}
        {mode === 'signup' && (
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>I agree that CivicPulse stores my name, email, mobile number and address. My name{isOrg(accountType) ? ' and organisation' : ''} and the reports and comments I post are public; my mobile number, address and location stay private. I accept the <Link to="/terms" className="font-semibold text-primary underline">Terms</Link> and <Link to="/privacy" className="font-semibold text-primary underline">Privacy policy</Link>.</span>
          </label>
        )}
        {!(mode === 'signup' && isGuest) && <Captcha key={captchaKey} onToken={onCaptcha} />}
        {error && <p role="alert" className="text-sm text-danger">{friendlyError(error)}</p>}
        {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
        <button type="submit" className="btn-primary btn w-full" disabled={busy || (captchaEnabled && !(mode === 'signup' && isGuest) && !captchaOk)}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
    </div>
  );
}
