import { useState, type FormEvent } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';

// Guests turn their guest session into a normal account by adding an email. Everything they
// reported stays with them because it is the same user.
export function SaveGuestAccount() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser(
      { email: email.trim(), data: { display_name: name.trim() } },
      { emailRedirectTo: `${window.location.origin}/profile` },
    );
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message.toLowerCase().includes('already') ? 'That email already has an account. Sign in with it instead; reports made as a guest stay on this device.' : error.message });
    else setMsg({ ok: true, text: `Almost done. Open the link we sent to ${email.trim()} to confirm. After that, set a password below or use "Forgot password" when signing in.` });
  }

  return (
    <section className="card border-primary/40 bg-primary-soft/60 p-4 lg:[column-span:all]">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Save size={18} /> You are tracking reports as a guest</h2>
      <p className="mt-1 text-sm text-muted">
        Your reports are saved on this device only. Add your email to keep them if you change phones, sign in elsewhere, or clear your browser.
        As a guest you can report (3 a day) and track your own reports. Saving your account also lets you back, comment on and follow reports, join events and save emergency contacts.
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input" required minLength={2} maxLength={60} autoComplete="name" placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save my account'}</button>
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>}
    </section>
  );
}

export function PasswordCard() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else { setPassword(''); setMsg({ ok: true, text: 'Password saved.' }); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound size={18} /> Password</h2>
      <p className="text-xs text-muted">Set or change the password you sign in with.</p>
      <input className="input" type="password" required minLength={10} autoComplete="new-password" aria-label="New password" placeholder="New password (at least 10 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="btn btn-ghost w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-semibold ${msg.ok ? 'text-leaf' : 'text-brick'}`}>{msg.ok ? msg.text : friendlyError(msg.text)}</p>}
    </form>
  );
}
