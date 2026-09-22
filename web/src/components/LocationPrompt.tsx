import { MapPin, Search } from 'lucide-react';
import { Modal } from './Modal';
import { useLocation2 } from '../hooks/useLocation';
import { useT } from '../lib/i18n';

// Shown when the app opens if location has not been decided yet. "Allow" then triggers the browser's
// own permission prompt, which browsers show more reliably after a tap.
export function LocationPrompt() {
  const loc = useLocation2();
  const { t } = useT();
  return (
    <Modal open={loc.askOnOpen} title={t('loc.title')} onClose={loc.dismissPrompt}>
      <div className="space-y-4 text-sm">
        <div className="flex gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><MapPin size={22} /></span>
          <p>{t('loc.body')}</p>
        </div>
        <ul className="space-y-1 text-xs text-muted">
          <li>• {t('loc.private')}</li>
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn btn-ghost" onClick={loc.dismissPrompt}><Search size={15} /> {t('loc.later')}</button>
          <button type="button" className="btn btn-primary" onClick={loc.useDevice}><MapPin size={16} /> {t('loc.allow')}</button>
        </div>
      </div>
    </Modal>
  );
}
