import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthValue {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  // Signed in with a guest session (no email yet). Reports still work; saving the account keeps them.
  isGuest: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  // The role always comes from the server, never from anything cached in the browser.
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_path, role, verified, points, account_type, org_name')
        .eq('id', userId!)
        .single();
      if (error) throw new Error(error.message);
      return data as Profile;
    },
  });

  const refreshProfile = useCallback(() => { qc.invalidateQueries({ queryKey: ['profile'] }); }, [qc]);

  const isGuest = Boolean(session?.user.is_anonymous);

  const signOut = useCallback(async () => {
    // A guest session cannot be signed back into, so leaving it loses access to those reports.
    if (isGuest && !window.confirm('You are using CivicPulse as a guest. If you sign out, you will lose access to the reports you made on this device. Add your email in Profile first to keep them. Sign out anyway?')) return;
    await supabase.auth.signOut();
    qc.clear();
    // The offline cache may hold this person's private data; never leave it for the next user of the device.
    try { await caches.delete('api'); } catch { /* Cache API unavailable */ }
  }, [qc, isGuest]);

  const value = useMemo<AuthValue>(() => ({
    session,
    userId,
    profile: profileQuery.data ?? null,
    loading: !ready || (Boolean(userId) && profileQuery.isLoading),
    isAdmin: profileQuery.data?.role === 'admin',
    isGuest,
    signOut,
    refreshProfile,
  }), [session, userId, profileQuery.data, profileQuery.isLoading, ready, isGuest, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
