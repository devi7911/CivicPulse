import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Award, Baby, BadgeCheck, Bus, CalendarDays, Database, ExternalLink, Flag, Gauge, Home, LayoutGrid, LifeBuoy, ListChecks, LogIn, LogOut, Megaphone, MessagesSquare, PlusSquare, Shield, Target, Trophy, User, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTiers } from '../hooks/useTiers';
import { useT } from '../lib/i18n';
import { tierProgress } from '../lib/tiers';
import { Avatar } from './Avatar';
import { ProfileGate } from './CompleteProfile';
import { DisplaySettings, DisplaySettingsButton } from './DisplaySettings';
import { LocationPrompt } from './LocationPrompt';
import { NotificationBell } from './NotificationBell';
import { OutboxSync } from './OutboxSync';
import { RouteTitle } from './RouteTitle';
import { SosButton } from './SosButton';

const TABS = [
  { to: '/', key: 'nav.home', icon: Home, end: true },
  { to: '/events', key: 'nav.events', icon: CalendarDays, end: false },
  { to: '/report', key: 'nav.report', icon: PlusSquare, end: false },
  { to: '/utilities', key: 'nav.utilities', icon: LayoutGrid, end: false },
  { to: '/profile', key: 'nav.profile', icon: User, end: false },
] as const;

// Staff get their own menu instead of the citizen one. Each item is a section of the admin console.
const STAFF_TABS = [
  { tab: '', label: 'Dashboard', icon: Gauge },
  { tab: 'issues', label: 'Tickets', icon: ListChecks },
  { tab: 'reports', label: 'Reports', icon: MessagesSquare },
  { tab: 'verify', label: 'Verify', icon: BadgeCheck },
  { tab: 'moderation', label: 'Moderation', icon: Flag },
  { tab: 'child', label: 'Missing child', icon: Baby },
  { tab: 'alerts', label: 'City alerts', icon: Megaphone },
  { tab: 'events', label: 'Events', icon: CalendarDays },
  { tab: 'people', label: 'People', icon: Users },
] as const;
const STAFF_PHONE_TABS = ['', 'issues', 'reports', 'moderation', 'people'] as const;

function useStaffTab() {
  const loc = useLocation();
  return loc.pathname === '/admin' ? new URLSearchParams(loc.search).get('tab') ?? '' : null;
}

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={`flex items-center gap-2 text-lg font-bold tracking-tight ${light ? 'text-white' : 'text-navy'}`}>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${light ? 'bg-white text-primary' : 'bg-primary text-white'}`} aria-hidden>
        <Activity size={18} strokeWidth={2.6} />
      </span>
      CivicPulse
    </Link>
  );
}

// Achievement banner: current tier, a thin progress bar and how far the next tier is.
function TierBanner({ variant }: { variant: 'bar' | 'panel' }) {
  const { profile } = useAuth();
  const tiers = useTiers();
  const progress = profile && tiers.data ? tierProgress(tiers.data, profile.points) : null;
  if (!profile || !progress) return null;
  const label = progress.next ? `${progress.pointsToNext} pts to ${progress.next.name}` : 'Top tier reached';

  if (variant === 'bar') {
    return (
      <Link to="/profile" aria-label={`${progress.current.name} tier, ${profile.points} points. ${label}`} className="block border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2 text-xs">
          <span className="flex items-center gap-1 font-bold text-navy"><Award size={14} className="text-primary" />{progress.current.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand"><span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} /></span>
          <span className="font-medium text-muted">{label}</span>
        </div>
      </Link>
    );
  }
  return (
    <Link to="/profile" className="block rounded-xl border border-line bg-paper p-3.5 transition hover:border-primary">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-bold text-navy"><Award size={16} className="text-primary" />{progress.current.name}</span>
        <span className="font-semibold text-primary">{profile.points} pts</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} /></div>
      <p className="mt-2 text-xs text-muted">{label}</p>
    </Link>
  );
}

function Sidebar() {
  const { profile, isAdmin, signOut } = useAuth();
  const { t } = useT();
  const item = (active: boolean) =>
    `relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors ${
      active ? 'bg-primary-soft font-bold text-primary' : 'font-medium text-ink hover:bg-sand'
    }`;

  const current = useStaffTab();

  if (isAdmin) {
    return (
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-56 flex-col border-e border-line bg-card lg:flex">
        <div className="flex items-center justify-between border-b border-line px-4 py-4"><Wordmark /><NotificationBell /></div>
        <p className="flex items-center gap-1.5 px-6 pt-4 text-[11px] font-bold tracking-widest text-muted uppercase"><Shield size={13} /> Staff</p>
        <nav aria-label="Staff" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-1">
            {STAFF_TABS.map(({ tab, label, icon: Icon }) => (
              <li key={tab}>
                <Link to={tab ? `/admin?tab=${tab}` : '/admin'} aria-current={current === tab ? 'page' : undefined} className={item(current === tab)}>
                  <Icon size={20} strokeWidth={current === tab ? 2.5 : 2} /> {label}
                </Link>
              </li>
            ))}
            <li className="mt-3 border-t border-line pt-3">
              <Link to="/?view=public" className={item(false)}><ExternalLink size={20} /> Public app</Link>
            </li>
          </ul>
        </nav>
        <div className="space-y-3 border-t border-line p-4">
          {profile && (
            <div className="flex items-center gap-2.5">
              <Avatar name={profile.display_name} path={profile.avatar_path} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{profile.display_name}</span><span className="text-[11px] text-muted">Admin</span></span>
              <button type="button" onClick={() => signOut()} aria-label={t('nav.signOut')} className="rounded-full p-2 text-muted hover:bg-sand hover:text-ink"><LogOut size={17} /></button>
            </div>
          )}
          <DisplaySettings />
        </div>
      </aside>
    );
  }

  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-56 flex-col border-e border-line bg-card lg:flex">
      <div className="flex items-center justify-between border-b border-line px-4 py-4"><Wordmark /><NotificationBell /></div>
      <div className="px-3 pt-4">
        <Link to="/report" className="btn btn-primary w-full shadow-md"><PlusSquare size={18} /> {t('nav.reportLong')}</Link>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-1">
          {TABS.map(({ to, key, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => item(isActive)}>
                {({ isActive }) => (<><Icon size={21} strokeWidth={isActive ? 2.5 : 2} /> {key === 'nav.report' ? t('nav.reportLong') : t(key)}</>)}
              </NavLink>
            </li>
          ))}
          <li><NavLink to="/buses" className={({ isActive }) => item(isActive)}><Bus size={21} /> {t('nav.buses')}</NavLink></li>
          <li><NavLink to="/scorecard" className={({ isActive }) => item(isActive)}><Trophy size={21} /> {t('nav.scorecard')}</NavLink></li>
          <li><NavLink to="/petitions" className={({ isActive }) => item(isActive)}><Megaphone size={21} /> {t('nav.petitions')}</NavLink></li>
          <li><NavLink to="/community" className={({ isActive }) => item(isActive)}><Target size={21} /> {t('nav.missions')}</NavLink></li>
          <li><NavLink to="/open-data" className={({ isActive }) => item(isActive)}><Database size={21} /> {t('nav.openData')}</NavLink></li>
          <li><NavLink to="/support" className={({ isActive }) => item(isActive)}><LifeBuoy size={21} /> Help &amp; feedback</NavLink></li>
          {isAdmin && (
            <li className="mt-3 border-t border-line pt-3">
              <NavLink to="/admin" className={({ isActive }) => item(isActive)}><Shield size={21} /> {t('nav.admin')}</NavLink>
            </li>
          )}
        </ul>
      </nav>

      <div className="space-y-3 border-t border-line p-4">
        <TierBanner variant="panel" />
        {profile ? (
          <div className="flex items-center gap-2.5">
            <Avatar name={profile.display_name} path={profile.avatar_path} size={36} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{profile.display_name}</span>
            <button type="button" onClick={() => signOut()} aria-label={t('nav.signOut')} className="rounded-full p-2 text-muted hover:bg-sand hover:text-ink"><LogOut size={17} /></button>
          </div>
        ) : (
          <Link to="/auth" className="btn btn-primary w-full"><LogIn size={17} /> {t('nav.signIn')}</Link>
        )}
        <DisplaySettings />
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted"><Link to="/support" className="hover:underline">Help</Link><Link to="/privacy" className="hover:underline">{t('nav.privacy')}</Link><Link to="/terms" className="hover:underline">{t('nav.terms')}</Link><Link to="/open-data" className="hover:underline">{t('nav.openData')}</Link><Link to="/advertise" className="hover:underline">{t('nav.advertise')}</Link></p>
      </div>
    </aside>
  );
}

export function AppShell() {
  const { profile, isAdmin } = useAuth();
  const { t } = useT();
  const current = useStaffTab();
  return (
    <div className="flex min-h-full flex-col lg:ps-56">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:font-bold focus:shadow-hard-sm">
        {t('nav.skip')}
      </a>
      <RouteTitle />
      <OutboxSync />
      {!isAdmin && <LocationPrompt />}
      <Sidebar />

      {/* Phone and tablet: brand bar plus the achievement strip. The sidebar replaces both on large screens. */}
      <div className="sticky top-0 z-30 lg:hidden">
        <header className="bg-navy">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <Wordmark light />
            <span className="flex items-center gap-1">
              {isAdmin ? <span className="me-0.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold text-white">Staff</span> : (
                <Link to="/report" aria-label={t('nav.reportLong')}
                  className="me-0.5 inline-flex min-h-9 items-center gap-1 rounded-full bg-brick px-2.5 text-sm font-bold whitespace-nowrap text-white shadow-sm hover:brightness-110">
                  <PlusSquare size={16} /> {t('nav.report')}
                </Link>
              )}
              <DisplaySettingsButton />
              {profile
                ? <><NotificationBell tone="light" /><Link to="/profile" aria-label={t('nav.profile')}><Avatar name={profile.display_name} path={profile.avatar_path} size={34} ring /></Link></>
                : <Link to="/auth" className="rounded-lg bg-white px-3 py-2 text-sm font-bold whitespace-nowrap text-primary">{t('nav.signIn')}</Link>}
            </span>
          </div>
        </header>
        {!isAdmin && <TierBanner variant="bar" />}
      </div>

      <main id="main" tabIndex={-1} className="outline-none mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-24 lg:max-w-[1500px] lg:px-6 3xl:max-w-[1800px] 3xl:px-8 lg:pt-6 lg:pb-10">
        <ProfileGate><Outlet /></ProfileGate>
      </main>

      {!isAdmin && <SosButton />}

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {isAdmin ? STAFF_PHONE_TABS.map((tab) => {
            const { label, icon: Icon } = STAFF_TABS.find((x) => x.tab === tab)!;
            const on = current === tab;
            return (
              <li key={tab}>
                <Link to={tab ? `/admin?tab=${tab}` : '/admin'} aria-current={on ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] ${on ? 'font-bold text-primary' : 'font-medium text-muted'}`}>
                  <Icon size={23} strokeWidth={on ? 2.5 : 1.9} />{label}
                </Link>
              </li>
            );
          }) : TABS.map(({ to, key, icon: Icon, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] ${isActive ? 'font-bold text-primary' : 'font-medium text-muted'}`}>
                {({ isActive }) => (<><Icon size={23} strokeWidth={isActive ? 2.5 : 1.9} />{t(key)}</>)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
