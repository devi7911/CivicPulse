import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';

// Reached from the link in the password-reset email, which signs the user in for this one purpose.
export function ResetPassword() {
  const { userId, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else navigate('/profile', { replace: true });
  }

  if (loading) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;

  if (!userId) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pt-4 text-center">
        <h1 className="page-title">Link expired</h1>
        <p className="text-sm text-muted">This reset link is no longer valid. Request a new one from the sign-in screen.</p>
        <Link to="/auth" className="btn btn-primary w-full">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stagger card mx-auto max-w-md space-y-4 p-6 sm:p-8">
      <h1 className="page-title">Choose a <span className="marker">new password</span></h1>
      <div>
        <label className="label" htmlFor="np">New password</label>
        <input id="np" className="input" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-[11px] text-muted">At least 10 characters.</p>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-brick">{friendlyError(error)}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
