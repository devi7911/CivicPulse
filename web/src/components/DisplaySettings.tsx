import { useEffect, useRef, useState } from 'react';
import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { LANGS, LOW_CONFIDENCE, NEEDS_TRANSLATOR, useT, type Lang } from '../lib/i18n';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme';

export function DisplaySettings({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useT();
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  function pick(c: ThemeChoice) { setTheme(c); setThemeChoice(c); }
  const themes: [ThemeChoice, string, typeof Sun][] = [['system', t('theme.system'), Monitor], ['light', t('theme.light'), Sun], ['dark', t('theme.dark'), Moon]];
  const index = themes.findIndex(([c]) => c === theme);

  return (
    <div className={`space-y-2 ${compact ? '' : 'text-xs'}`}>
      <label className="flex items-center gap-2">
        <Globe size={15} className="shrink-0 text-muted" />
        <span className="sr-only">{t('settings.language')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="input min-h-9 py-1 text-xs" aria-label={t('settings.language')}>
          {(Object.keys(LANGS) as Lang[]).map((l) => <option key={l} value={l}>{LANGS[l]}</option>)}
        </select>
      </label>
      {/* One sliding toggle, not three separate buttons: a thumb moves behind whichever option is active. */}
      <div role="radiogroup" aria-label={t('settings.theme')} className="relative grid grid-cols-3 rounded-full bg-sand p-1">
        <span aria-hidden className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-sm transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${index * 100}%)` }} />
        {themes.map(([c, label, Icon]) => (
          <button key={c} type="button" role="radio" aria-checked={theme === c} onClick={() => pick(c)}
            className={`relative z-10 flex min-h-8 items-center justify-center gap-1 rounded-full text-[11px] font-semibold transition-colors ${theme === c ? 'text-primary' : 'text-muted'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {NEEDS_TRANSLATOR.includes(lang) ? (
        <p className="text-[10px] text-muted">Translation needed. Showing English until a native speaker translates this language.</p>
      ) : lang !== 'en' && (
        <p className="text-[10px] text-muted">Draft translation{LOW_CONFIDENCE.includes(lang) ? ' (early)' : ''}; some text is still in English.</p>
      )}
    </div>
  );
}

// Phone header: a globe button that opens the same settings.
export function DisplaySettingsButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { t } = useT();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${t('settings.language')} · ${t('settings.theme')}`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 hover:bg-white/10"><Globe size={19} /></button>
      {open && <div className="absolute top-full right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-card p-3 text-ink shadow-xl"><DisplaySettings compact /></div>}
    </div>
  );
}
