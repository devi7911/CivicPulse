// Light, dark or follow the device. The choice is a per-device preference.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'civicpulse:theme';

export function getThemeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && Boolean(media?.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1320' : '#0a2540');
}

export function setThemeChoice(choice: ThemeChoice) {
  try { if (choice === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { /* private mode */ }
  applyTheme(choice);
}

// Keep following the device when it switches between light and dark.
media?.addEventListener('change', () => { if (getThemeChoice() === 'system') applyTheme('system'); });
