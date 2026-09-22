import { useEffect, useRef } from 'react';

// Cloudflare Turnstile (free). Active only when VITE_TURNSTILE_SITE_KEY is set; the same site's
// secret key must be entered in Supabase Auth > Bot and Abuse Protection.
export const CAPTCHA_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
export const captchaEnabled = CAPTCHA_SITE_KEY.length > 0;

let token: string | null = null;
export const getCaptchaToken = () => token;
export const clearCaptchaToken = () => { token = null; };

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Could not load the security check.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function Captcha({ onToken }: { onToken?: (t: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!captchaEnabled) return;
    let id: string | null = null;
    let alive = true;
    loadScript().then(() => {
      if (!alive || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: CAPTCHA_SITE_KEY,
        size: 'flexible',
        callback: (t: string) => { token = t; onToken?.(t); },
        'expired-callback': () => { token = null; onToken?.(null); },
        'error-callback': () => { token = null; onToken?.(null); },
      });
    }).catch(() => onToken?.(null));
    return () => { alive = false; if (id && window.turnstile) window.turnstile.remove(id); token = null; };
  }, [onToken]);
  if (!captchaEnabled) return null;
  return <div ref={box} className="min-h-[65px]" />;
}
