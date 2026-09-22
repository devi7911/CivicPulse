import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PlaceSearch } from '../components/PlaceSearch';
import { useLocation2 } from '../hooks/useLocation';
import { useT, type TKey } from '../lib/i18n';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Bus as BusIcon, ChevronRight, CreditCard, Grid3x3, LayoutGrid, Map as MapIcon, Megaphone, Rows3, Search, Target, Trophy, X, type LucideIcon } from 'lucide-react';
import { AmberAlerts } from '../components/AmberAlerts';
import { CityAlerts } from '../components/CityAlerts';
import { FeedActionsProvider } from '../components/CardActions';
import { ContributionsFeed } from '../components/Contributions';
import { ForYouCard, PetitionsCard, RecentlyFixed, TrendingCard, WeatherCard, WeekStrip, useDashboard } from '../components/DashboardWidgets';
import { CATEGORY_ICON } from '../components/CategoryArt';
import { IssueCard, SponsoredBanner } from '../components/FeedCards';
import { IssueTile, SponsoredTile, isFeatured } from '../components/PostTile';
import { friendlyError } from '../lib/friendlyError';
const IssuesMap = lazy(() => import('../components/IssueMap').then((m) => ({ default: m.IssuesMap })));
import { useAuth } from '../hooks/useAuth';
import { ISSUE_CATEGORIES, ISSUE_SELECT, formatEventTime } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { CityEvent, Issue, IssueCategory, SponsoredPost } from '../lib/types';

const PAGE = 10;

interface ServedAd { id: string; title: string; body: string; cta_label: string; cta_url: string; media_path: string | null; media_type: string | null; advertiser: string; advertiser_website: string | null; verified: boolean }

// Supabase queries are lazy: nothing is sent until the result is awaited or .then() is called.
function trackAd(id: string, kind: 'view' | 'click') {
  supabase.rpc('record_ad_event', { p_campaign: id, p_kind: kind }).then(() => undefined, () => undefined);
}

// Counts a campaign view once per page load; the server also de-duplicates per network per day.
const viewed = new Set<string>();
function useAdView(ad: SponsoredPost | null) {
  useEffect(() => {
    if (!ad?.campaign || viewed.has(ad.id)) return;
    viewed.add(ad.id);
    trackAd(ad.id, 'view');
  }, [ad]);
}

type ViewMode = 'grid' | 'list' | 'map';
const VIEW_KEY = 'civicpulse:feed-view';

const DISMISS_KEY = 'civicpulse:closed-sponsored';
const DISMISS_DAYS = 7;

// Closed sponsored posts are remembered on this device and come back after a week.
function loadDismissed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '{}') as Record<string, number>;
    const cutoff = Date.now() - DISMISS_DAYS * 86_400_000;
    return Object.fromEntries(Object.entries(raw).filter(([, at]) => typeof at === 'number' && at > cutoff));
  } catch { return {}; }
}

function loadView(): ViewMode {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'list' || v === 'map' ? v : 'grid'; } catch { return 'grid'; }
}

type SortMode = 'latest' | 'updated' | 'backed' | 'near' | 'attention' | 'following';
type StatusFilter = 'all' | 'open' | 'fixed';
type Period = 'any' | 'today' | 'week' | 'month';
const SORTS: Record<SortMode, TKey> = { latest: 'sort.latest', updated: 'sort.updated', backed: 'sort.backed', near: 'sort.near', attention: 'sort.attention', following: 'sort.following' };
const PERIODS: Record<Period, TKey> = { any: 'filter.anyTime', today: 'filter.today', week: 'filter.week', month: 'filter.month' };
const CAT_KEY: Record<IssueCategory, TKey> = { roads: 'cat.roads', waste: 'cat.waste', lighting: 'cat.lighting', water: 'cat.water', parks: 'cat.parks', other: 'cat.other' };
function periodStart(p: Period): string | null {
  if (p === 'any') return null;
  if (p === 'today') return new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00+05:30`).toISOString();
  return new Date(Date.now() - (p === 'week' ? 7 : 30) * 86_400_000).toISOString();
}
// Straight-line distance in metres (for filtering map pins to the chosen radius).
function metres(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat! - a.lat), dLng = r(b.lng! - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat!)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

interface Stats { total: number; pending: number; progress: number; resolved: number; closed: number; overdue: number }

// Characters that would break the search filter syntax are dropped.
const cleanSearch = (q: string) => q.replace(/[,()*%\\"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

const QUICK: { to: string; label: TKey; hint: string; icon: LucideIcon }[] = [
  { to: '/petitions', label: 'quick.petitions', hint: 'Propose a change', icon: Megaphone },
  { to: '/buses', label: 'nav.buses', hint: 'Stops, routes, timings', icon: BusIcon },
  { to: '/community', label: 'quick.missions', hint: 'Challenges and top helpers', icon: Target },
  { to: '/utilities', label: 'quick.bills', hint: 'Bills and helplines', icon: CreditCard },
];

export function Feed() {
  const { profile } = useAuth();
  const { t } = useT();
  const [category, setCategory] = useState<IssueCategory | 'all'>('all');
  const [view, setView] = useState<ViewMode>(loadView);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setSearch(cleanSearch(searchInput)), 350); return () => window.clearTimeout(t); }, [searchInput]);
  const [dismissed, setDismissed] = useState<Record<string, number>>(loadDismissed);

  const [justClosed, setJustClosed] = useState<string | null>(null);

  function saveDismissed(next: Record<string, number>) {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }

  function dismissSponsored(id: string) {
    setDismissed((prev) => saveDismissed({ ...prev, [id]: Date.now() }));
    setJustClosed(id);
  }

  function undoDismiss() {
    if (!justClosed) return;
    setDismissed((prev) => { const { [justClosed]: _gone, ...rest } = prev; return saveDismissed(rest); });
    setJustClosed(null);
  }

  // The confirmation clears itself after a few seconds.
  useEffect(() => {
    if (!justClosed) return;
    const t = window.setTimeout(() => setJustClosed(null), 10000);
    return () => window.clearTimeout(t);
  }, [justClosed]);

  // The choice is a personal preference, so it stays on this device.
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

  const stats = useQuery({
    queryKey: ['issue-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('issue_stats');
      if (error) throw new Error(error.message);
      return data as Stats;
    },
  });

  const [feedTab, setFeedTab] = useState<'reports' | 'community'>(() => {
    try { return sessionStorage.getItem('civicpulse:feed-tab') === 'community' ? 'community' : 'reports'; } catch { return 'reports'; }
  });
  useEffect(() => { try { sessionStorage.setItem('civicpulse:feed-tab', feedTab); } catch { /* private mode */ } }, [feedTab]);
  const [sort, setSort] = useState<SortMode>('latest');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [radius, setRadius] = useState<number | null>(3000);
  const loc = useLocation2();
  const here = loc.centre;
  const pickedSort = useRef(false);
  const dash = useDashboard();

  // Once a location or searched place is known, the feed opens on reports near it,
  // unless the person already chose another order.
  useEffect(() => {
    if (here && !pickedSort.current) setSort('near');
    if (!here && sort === 'near') setSort('latest');
  }, [here]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseSort(next: SortMode) {
    pickedSort.current = true;
    if (next === 'near' && !here) { loc.useDevice(); pickedSort.current = false; return; }
    setSort(next);
  }

  const [period, setPeriod] = useState<Period>('any');
  const [area, setArea] = useState<string>('');
  const { userId } = useAuth();

  const areas = useQuery({
    queryKey: ['report-areas'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_areas');
      if (error) throw new Error(error.message);
      return data as { area: string; total: number; open: number }[];
    },
  });
  const catCounts = useQuery({
    queryKey: ['category-counts'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('category_counts');
      if (error) throw new Error(error.message);
      return data as Partial<Record<IssueCategory, number>>;
    },
  });

  const issues = useInfiniteQuery({
    queryKey: ['issues', category, search, sort, status, here?.lat, here?.lng, radius, period, area, userId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      // Near me: the server orders public report ids by distance; the reports load through the normal query.
      let nearIds: string[] | null = null;
      let distance = new Map<string, number>();
      if (sort === 'following') {
        // Reports the person made, backs or follows.
        if (!userId) return [];
        const [mine, ups, fol] = await Promise.all([
          supabase.rpc('my_issues').select('id'),
          supabase.from('issue_upvotes').select('issue_id').eq('user_id', userId),
          supabase.from('issue_follows').select('issue_id').eq('user_id', userId),
        ]);
        const ids = [...new Set([
          ...((mine.data ?? []) as { id: string }[]).map((r) => r.id),
          ...(ups.data ?? []).map((r) => r.issue_id as string),
          ...(fol.data ?? []).map((r) => r.issue_id as string),
        ])];
        if (ids.length === 0) return [];
        let fq = supabase.from('issues').select(ISSUE_SELECT).in('id', ids.slice(0, 200)).order('updated_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1);
        if (category !== 'all') fq = fq.eq('category', category);
        if (status === 'open') fq = fq.in('status', ['pending', 'progress']); else if (status === 'fixed') fq = fq.eq('status', 'resolved');
        const { data, error } = await fq;
        if (error) throw new Error(error.message);
        return data as unknown as Issue[];
      }
      if (sort === 'near' && here) {
        if (pageParam > 0) return [];
        const { data, error } = await supabase.rpc('issues_near', { p_lat: here.lat, p_lng: here.lng, p_limit: 60, p_radius_m: radius });
        if (error) throw new Error(error.message);
        const rows = data as { id: string; distance_m: number }[];
        nearIds = rows.map((r) => r.id);
        distance = new Map(rows.map((r) => [r.id, r.distance_m]));
        if (nearIds.length === 0) return [];
      }
      let q = supabase.from('issues').select(ISSUE_SELECT);
      if (nearIds) q = q.in('id', nearIds);
      else {
        q = sort === 'backed' ? q.order('upvote_count', { ascending: false }).order('created_at', { ascending: false })
          : sort === 'attention' ? q.order('target_date', { ascending: true, nullsFirst: false }).order('priority_score', { ascending: false })
          : sort === 'updated' ? q.order('updated_at', { ascending: false })
          : q.order('created_at', { ascending: false });
        q = q.range(pageParam, pageParam + PAGE - 1);
      }
      if (sort === 'attention') q = q.in('status', ['pending', 'progress']).lt('target_date', todayIST());
      else if (status === 'open') q = q.in('status', ['pending', 'progress']);
      else if (status === 'fixed') q = q.eq('status', 'resolved');
      if (category !== 'all') q = q.eq('category', category);
      if (area) q = q.eq('area', area);
      const since = periodStart(period);
      if (since) q = q.gte('created_at', since);
      if (search) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,location_text.ilike.%${search}%,ref_no.ilike.%${search}%,area.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data as unknown as Issue[];
      if (!nearIds) return rows;
      return rows.map((r) => ({ ...r, distance_m: distance.get(r.id) })).sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    },
    getNextPageParam: (last, all) => (sort !== 'near' && last.length === PAGE ? all.length * PAGE : undefined),
  });

  // Tell people when newer reports exist instead of silently going stale.
  const newest = issues.data?.pages[0]?.[0]?.created_at ?? null;
  const fresh = useQuery({
    queryKey: ['issues', 'newer-than', newest],
    enabled: Boolean(newest) && sort === 'latest' && !search,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('issues').select('id', { count: 'exact', head: true }).gt('created_at', newest!);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });

  // Paid marketplace campaigns first (matched to the category being browsed, never to the person),
  // then house ads that admins publish for vetted NGOs.
  const sponsored = useQuery({
    queryKey: ['sponsored', category],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [camp, house] = await Promise.all([
        supabase.rpc('serve_ads', { p_category: category === 'all' ? null : category, p_limit: 3 }),
        supabase.from('sponsored_posts').select('id, title, body, media_path, media_type, ngo:ngos(name, donate_url, website)')
          .eq('active', true).order('created_at', { ascending: false }).limit(5),
      ]);
      if (house.error) throw new Error(house.error.message);
      const campaigns: SponsoredPost[] = ((camp.data ?? []) as ServedAd[]).map((a) => ({
        id: a.id, title: a.title, body: a.body, media_path: a.media_path, media_type: a.media_type as SponsoredPost['media_type'],
        ngo: { name: a.advertiser, donate_url: a.cta_url, website: a.advertiser_website },
        cta_label: a.cta_label, campaign: true, verified: a.verified,
      }));
      return [...campaigns, ...(house.data as unknown as SponsoredPost[])];
    },
  });

  // The map shows every pinned report that matches the filters, not just the loaded page.
  const mapIssues = useQuery({
    queryKey: ['issues', 'map', category, search, status, period, area],
    enabled: view === 'map',
    queryFn: async () => {
      let q = supabase.from('issues').select(ISSUE_SELECT).not('lat', 'is', null).order('created_at', { ascending: false }).limit(500);
      if (category !== 'all') q = q.eq('category', category);
      if (status === 'open') q = q.in('status', ['pending', 'progress']); else if (status === 'fixed') q = q.eq('status', 'resolved');
      if (area) q = q.eq('area', area);
      const since = periodStart(period);
      if (since) q = q.gte('created_at', since);
      if (search) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,location_text.ilike.%${search}%,ref_no.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data as unknown as Issue[];
    },
  });

  const upcoming = useQuery({
    queryKey: ['events', 'upcoming'],
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').gte('ends_at', new Date().toISOString()).order('starts_at').limit(3);
      if (error) throw new Error(error.message);
      return data as CityEvent[];
    },
  });

  const list = issues.data?.pages.flat() ?? [];
  // One sponsored post at a time, always first. Closing it reveals the next one, if any.
  const topAd = (sponsored.data ?? []).find((a) => !(a.id in dismissed)) ?? null;
  const adClick = topAd?.campaign ? () => trackAd(topAd.id, 'click') : undefined;
  useAdView(view !== 'map' && list.length > 0 ? topAd : null);
  const s = stats.data;
  const rate = s && s.total > 0 ? Math.round((s.resolved / s.total) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'greet.morning' : hour < 17 ? 'greet.afternoon' : 'greet.evening');

  return (
    <FeedActionsProvider ids={list.map((i) => i.id)}>
    {/* Missing-child alerts come first, above everything else on the feed. */}
    <div className="mb-4 empty:hidden"><AmberAlerts /></div>
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-6 3xl:grid-cols-[minmax(0,1fr)_21rem]">
      {/* Summary rail: first on phones, right-hand column on desktop */}
      <aside className="stagger grid gap-4 md:grid-cols-2 xl:col-start-2 xl:row-start-1 xl:grid-cols-1">
        <div className="empty:hidden md:col-span-2 xl:col-span-1"><CityAlerts /></div>
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy to-primary text-white shadow-hard">
          <div className="px-5 pt-5">
            <p className="text-sm text-white/75">{greeting}{profile ? `, ${profile.display_name.split(' ')[0]}` : ''}</p>
            <h1 className="mt-0.5 text-xl font-bold">{t('city.title')}</h1>
          </div>
          <dl className="mt-4 grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 rtl:divide-x-reverse">
            {([[t('city.open'), s ? s.pending + s.progress : 0], [t('city.resolved'), s?.resolved ?? 0], [t('city.fixRate'), `${rate}%`]] as const).map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse px-5 py-4">
                <dt className="text-xs text-white/70">{label}</dt>
                <dd className="text-2xl font-bold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
          <WeekStrip d={dash.data} />
          <div className="grid grid-cols-2 divide-x divide-white/15 border-t border-white/15 bg-white/10 text-sm font-bold">
            <Link to="/report" className="flex min-h-12 items-center justify-between gap-1 px-4 py-3 whitespace-nowrap transition hover:bg-white/20 sm:px-5">{t('city.report')} <ChevronRight size={18} className="shrink-0 rtl:rotate-180" /></Link>
            <Link to="/scorecard" className="flex min-h-12 items-center justify-between gap-1 px-4 py-3 transition hover:bg-white/20 sm:px-5"
              aria-label={s && s.overdue > 0 ? `Scorecard, ${s.overdue} report${s.overdue > 1 ? 's' : ''} past the promised fix date` : 'Scorecard'}>
              <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <Trophy size={15} className="shrink-0" /> {t('nav.scorecard')}
                {s && s.overdue > 0 && <span className="rounded-full bg-brick px-1.5 py-0.5 text-[10px] leading-none font-bold">{s.overdue} {t('city.late')}</span>}
              </span>
              <ChevronRight size={18} className="shrink-0 rtl:rotate-180" />
            </Link>
          </div>
        </section>

        <ForYouCard />

        <nav aria-label="Quick actions" className="card grid grid-cols-4 gap-1 p-2 md:grid-cols-2 xl:grid-cols-4">
          {QUICK.map(({ to, label, hint, icon: Icon }) => (
            <Link key={label} to={to} className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-center transition hover:bg-sand md:flex-row md:gap-3 md:text-left xl:flex-col xl:gap-1.5 xl:text-center">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon size={20} /></span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold md:text-sm xl:text-[11px]">{t(label)}</span>
                <span className="hidden truncate text-xs text-muted md:block xl:hidden">{hint}</span>
              </span>
            </Link>
          ))}
        </nav>

        {(upcoming.data?.length ?? 0) > 0 && (
          <section className="card hidden p-4 xl:block">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">Upcoming events</h2>
              <Link to="/events" className="-my-2 inline-flex min-h-9 items-center px-1 text-xs font-semibold text-primary hover:underline">See all</Link>
            </div>
            <ul className="divide-y divide-line">
              {upcoming.data!.map((ev) => (
                <li key={ev.id}>
                  <Link to="/events" className="block py-2.5 hover:text-primary">
                    <p className="line-clamp-1 text-sm font-semibold">{ev.title}</p>
                    <p className="text-xs text-muted">{formatEventTime(ev.starts_at, ev.ends_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="hidden xl:contents">
          <TrendingCard d={dash.data} />
          <WeatherCard />
          <PetitionsCard d={dash.data} />
        </div>
      </aside>

      {/* Feed column */}
      <div className="mt-4 min-w-0 space-y-4 xl:col-start-1 xl:row-start-1 xl:mt-0">
        <div role="tablist" aria-label="Feed" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1">
          {([['reports', t('feed.tabReports')], ['community', t('feed.tabCommunity')]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={feedTab === k} onClick={() => setFeedTab(k)}
              className={`min-h-10 rounded-lg text-sm font-semibold transition ${feedTab === k ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        {feedTab === 'community' ? <ContributionsFeed /> : (<>
        <div className="card no-scrollbar flex gap-3 overflow-x-auto px-4 py-3" role="group" aria-label="Filter by category">
          <CategoryDot label={t('cat.all')} active={category === 'all'} onClick={() => setCategory('all')} icon={LayoutGrid} from="#e8f1fb" to="#cfe2f7" fg="#0b5cad" />
          {(Object.keys(ISSUE_CATEGORIES) as IssueCategory[]).map((c) => (
            <CategoryDot key={c} label={t(CAT_KEY[c])} count={catCounts.data?.[c]} active={category === c} onClick={() => setCategory(c)} {...CATEGORY_ICON[c]} />
          ))}
        </div>

        <div className="relative">
          <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')} className="input ps-10 pe-10" />
          {searchInput && (
            <button type="button" onClick={() => setSearchInput('')} aria-label={t('search.clear')} className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted hover:bg-sand"><X size={16} /></button>
          )}
        </div>

        {!search && category === 'all' && status !== 'fixed' && <RecentlyFixed d={dash.data} />}
        <UpcomingStrip events={upcoming.data} />

        <div className="flex flex-wrap items-center gap-2">
          <PlaceSearch />
          <div role="group" aria-label="Sort reports" className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1">
            {(Object.keys(SORTS) as SortMode[]).filter((k) => k !== 'following' || userId).map((k) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => chooseSort(k)} className={`chip whitespace-nowrap ${sort === k ? 'chip-on' : ''}`}>
                {k === 'near' && loc.locating ? t('sort.finding') : t(SORTS[k])}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          {sort !== 'attention' && (
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="input min-h-9 w-auto py-1 text-xs">
              <option value="all">{t('filter.allStatus')}</option><option value="open">{t('filter.open')}</option><option value="fixed">{t('filter.fixed')}</option>
            </select>
          )}
          {sort !== 'following' && (
            <select aria-label="Filter by time" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="input min-h-9 w-auto py-1 text-xs">
              {(Object.keys(PERIODS) as Period[]).map((p) => <option key={p} value={p}>{t(PERIODS[p])}</option>)}
            </select>
          )}
          {sort !== 'following' && (areas.data?.length ?? 0) > 0 && (
            <select aria-label="Filter by area" value={area} onChange={(e) => setArea(e.target.value)} className="input min-h-9 w-auto max-w-[12rem] py-1 text-xs">
              <option value="">{t('filter.allAreas')}</option>
              {areas.data!.map((a) => <option key={a.area} value={a.area}>{a.area} ({a.open} open)</option>)}
            </select>
          )}
          {(status !== 'all' || period !== 'any' || area || category !== 'all') && (
            <button type="button" className="text-xs font-semibold text-primary underline" onClick={() => { setStatus('all'); setPeriod('any'); setArea(''); setCategory('all'); }}>{t('filter.clear')}</button>
          )}
        </div>
        {loc.error && <p role="alert" className="text-xs font-semibold text-brick">{friendlyError(loc.error)}</p>}
        {sort === 'near' && here && (
          <div role="group" aria-label="Distance" className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{t('filter.within')}</span>
            {([[1000, '1 km'], [3000, '3 km'], [5000, '5 km'], [null, t('filter.city')]] as const).map(([r, label]) => (
              <button key={label} type="button" aria-pressed={radius === r} onClick={() => setRadius(r)} className={`chip ${radius === r ? 'chip-on' : ''}`}>{label}</button>
            ))}
          </div>
        )}

        {(fresh.data ?? 0) > 0 && (
          <button type="button" onClick={() => { void issues.refetch(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="mx-auto flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white shadow-md">
            {t('feed.newReports', { n: fresh.data ?? 0 })}
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">{search ? t('feed.results', { x: search }) : sort === 'near' ? (here?.source === 'place' ? t('feed.nearPlace', { x: here.label }) : t('feed.nearYou')) : sort === 'attention' ? t('feed.attention') : sort === 'backed' ? t('feed.backed') : sort === 'following' ? t('feed.following') : sort === 'updated' ? t('feed.updated') : area ? t('feed.inArea', { x: area }) : category === 'all' ? t('feed.latest') : t(CAT_KEY[category])}</h2>
          <div role="group" aria-label="Choose layout" className="flex rounded-lg border border-line bg-card p-0.5">
            {([['grid', t('view.grid'), Grid3x3], ['list', t('view.list'), Rows3], ['map', t('view.map'), MapIcon]] as const).map(([mode, label, Icon]) => (
              <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}
                className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === mode ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>

        {issues.isLoading && view !== 'map' && <FeedSkeleton view={view} />}
        {issues.isError && (
          <div className="card px-6 py-8 text-center text-sm">
            <p className="font-semibold text-brick">{t('feed.error')}</p>
            <button type="button" className="btn btn-ghost mt-3" onClick={() => void issues.refetch()}>{t('feed.retry')}</button>
          </div>
        )}
        {!issues.isLoading && list.length === 0 && !issues.isError && view !== 'map' && (
          <div className="card px-6 py-10 text-center">
            {sort === 'near' && here ? (
              <>
                <p className="text-lg font-bold">{t('empty.nearNone', { r: radius ? `${radius / 1000} km` : t('filter.city'), x: here.source === 'place' ? here.label : t('sort.near') })}</p>
                <p className="mt-1 text-sm text-muted">{t('empty.nearGood')}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {radius !== null && radius < 5000 && <button type="button" className="btn btn-ghost" onClick={() => setRadius(radius < 3000 ? 3000 : 5000)}>{t('empty.widen', { r: `${radius < 3000 ? 3 : 5} km` })}</button>}
                  {radius !== null && <button type="button" className="btn btn-ghost" onClick={() => setRadius(null)}>{t('filter.city')}</button>}
                  <Link to="/report" className="btn btn-primary">{t('empty.reportHere')}</Link>
                </div>
              </>
            ) : sort === 'following' ? (
              <>
                <p className="text-lg font-bold">{t('empty.follow')}</p>
                <p className="mt-1 text-sm text-muted">{t('empty.followHint')}</p>
                <button type="button" className="btn btn-ghost mt-4" onClick={() => setSort('latest')}>{t('empty.browse')}</button>
              </>
            ) : (status !== 'all' || period !== 'any' || area || category !== 'all') && !search ? (
              <>
                <p className="text-lg font-bold">{t('empty.filters')}</p>
                <button type="button" className="btn btn-ghost mt-4" onClick={() => { setStatus('all'); setPeriod('any'); setArea(''); setCategory('all'); }}>{t('filter.clear')}</button>
              </>
            ) : (
              <>
                <p className="text-lg font-bold">{search ? t('empty.search') : t('empty.none')}</p>
                <p className="mt-1 text-sm text-muted">{search ? 'Try another word, an area name, or the reference number.' : t('empty.first')}</p>
                <Link to="/report" className="btn btn-primary mt-4">{t('city.report')}</Link>
              </>
            )}
          </div>
        )}

        {view === 'map' ? (
          mapIssues.isLoading ? <p className="py-8 text-center text-sm text-muted">Loading the mapâ€¦</p> : <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Loading the mapâ€¦</p>}>
            <IssuesMap
              issues={(mapIssues.data ?? []).filter((i) => !(sort === 'near' && here && radius && i.lat != null && i.lng != null) || metres(here!, i) <= radius!)}
              centre={sort === 'near' ? here : null} radius={sort === 'near' ? radius : null} />
          </Suspense>
        ) : view === 'grid' ? (
        <div className="grid grid-flow-dense grid-cols-2 gap-1.5 sm:gap-2.5 md:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {topAd && list.length > 0 && <SponsoredTile post={topAd} onDismiss={dismissSponsored} onClick={adClick} />}
          {list.map((issue) => <IssueTile key={issue.id} issue={issue} featured={isFeatured(issue)} />)}
        </div>
        ) : (
        <div className="space-y-4">
          {topAd && list.length > 0 && <SponsoredBanner post={topAd} onDismiss={dismissSponsored} onClick={adClick} />}
          {list.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
        </div>
        )}

        {view !== 'map' && issues.hasNextPage && (
          <LoadMore loading={issues.isFetchingNextPage} onMore={() => void issues.fetchNextPage()} />
        )}

        {/* Phones and tablets: the side-column extras sit under the feed. */}
        <div className="grid gap-4 md:grid-cols-2 xl:hidden">
          <TrendingCard d={dash.data} />
          <WeatherCard />
          <PetitionsCard d={dash.data} />
        </div>
        </>)}
      </div>
      {justClosed && (
        <div role="status" className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:ps-56">
          <div className="flex items-center gap-3 rounded-full bg-navy py-2 pr-2 pl-4 text-sm text-white shadow-xl">
            Sponsored post hidden for {DISMISS_DAYS} days
            <button type="button" onClick={undoDismiss} className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">Undo</button>
          </div>
        </div>
      )}
    </div>
    </FeedActionsProvider>
  );
}

// Loads the next page automatically when the end of the feed scrolls into view; the button is a fallback.
function LoadMore({ loading, onMore }: { loading: boolean; onMore: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !loading) onMore(); }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, onMore]);
  return (
    <button ref={ref} type="button" className="btn btn-ghost mx-auto flex w-full sm:w-72" disabled={loading} onClick={onMore}>
      {loading ? t('feed.loadingMore') : t('feed.loadMore')}
    </button>
  );
}

// Grey placeholder cards shaped like the real ones while the feed loads.
function FeedSkeleton({ view }: { view: ViewMode }) {
  const n = view === 'grid' ? 6 : 3;
  return (
    <div aria-busy="true" aria-label="Loading reports" className={view === 'grid' ? 'grid grid-cols-2 gap-1.5 sm:gap-2.5 md:grid-cols-3 2xl:grid-cols-4' : 'space-y-4'}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-xl border border-line bg-card">
          <div className={view === 'grid' ? 'aspect-square bg-sand' : 'h-40 bg-sand'} />
          <div className="space-y-2 p-3">
            <div className="h-3 w-1/3 rounded bg-sand" />
            <div className="h-3 w-5/6 rounded bg-sand" />
            <div className="h-3 w-1/2 rounded bg-sand" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Phones and tablets: upcoming events appear inside the feed (desktop shows them in the side column).
function UpcomingStrip({ events }: { events: CityEvent[] | undefined }) {
  const { t } = useT();
  if (!events?.length) return null;
  return (
    <section aria-labelledby="up-h" className="card p-3 xl:hidden">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="up-h" className="text-sm font-bold">{t('widget.upcoming')}</h2>
        <Link to="/events" className="-my-2 inline-flex min-h-9 items-center px-1 text-xs font-semibold text-primary hover:underline">{t('widget.allEvents')}</Link>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {events.map((ev) => (
          <li key={ev.id} className="w-60 shrink-0">
            <Link to="/events" className="block rounded-xl border border-line p-3 hover:border-primary">
              <p className="line-clamp-1 text-sm font-semibold">{ev.title}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted">{formatEventTime(ev.starts_at, ev.ends_at)}</p>
              <p className="line-clamp-1 text-xs text-muted">{ev.location_text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Category filter drawn like a row of story circles, with the number of open reports.
function CategoryDot({ label, count, active, onClick, icon: Icon, from, to, fg }: { label: string; count?: number; active: boolean; onClick: () => void; icon: LucideIcon; from: string; to: string; fg: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} aria-label={count ? `${label}, ${count} open` : label} className="relative flex w-16 shrink-0 flex-col items-center gap-1.5">
      {count ? <span className="absolute top-0 right-1 z-10 min-w-5 rounded-full border-2 border-white bg-brick px-1 text-center text-[10px] leading-4 font-bold text-white">{count}</span> : null}
      <span className={`rounded-full p-[3px] transition ${active ? 'bg-gradient-to-tr from-primary to-navy' : 'bg-line'}`}>
        <span className="flex h-13 w-13 items-center justify-center rounded-full border-2 border-white" style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, color: fg }}>
          <Icon size={21} strokeWidth={1.9} />
        </span>
      </span>
      <span className={`w-full truncate text-center text-[11px] ${active ? 'font-bold text-primary' : 'font-medium text-muted'}`}>{label}</span>
    </button>
  );
}
