import { scrub } from './scrub';
import { supabase } from './supabase';

const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) ?? 'dev';
let sent = 0;
const seen = new Set<string>();

// Sends at most 10 distinct errors per page load to the admin-only error log.
export function reportError(err: unknown): void {
  if (!import.meta.env.PROD) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const message = scrub(e.message || 'Unknown error').slice(0, 500);
  if (sent >= 10 || seen.has(message)) return;
  seen.add(message);
  sent += 1;
  void supabase.from('client_errors').insert({
    message,
    stack: e.stack ? scrub(e.stack).slice(0, 4000) : null,
    path: window.location.pathname.slice(0, 200),
    release: RELEASE.slice(0, 40),
    user_agent: navigator.userAgent.slice(0, 300),
  }).then(() => undefined, () => undefined);
}

export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));
}
