import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Bell, CheckCircle2, CloudRain, Flame, Megaphone, Sun, ThumbsUp, Wind } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLocation2 } from '../hooks/useLocation';
import { useT } from '../lib/i18n';
import { ISSUE_CATEGORIES, ISSUE_COLS, STATUS_CLASS, STATUS_LABEL, fixState } from '../lib/constants';
import { photoUrl, supabase } from '../lib/supabase';
import type { Issue, IssueCategory, IssueStatus } from '../lib/types';

export interface DashboardSummary {
  reported_7d: number; reported_prev_7d: number; fixed_7d: number; avg_days_to_fix: number | null;
  trending: { id: string; ref_no: string; title: string; category: IssueCategory; status: IssueStatus; upvote_count: number; comment_count: number; location_text: string }[];
  recently_fixed: { id: string; ref_no: string; title: string; photo_path: string | null; resolved_photo_path: string; resolved_at: string; assignee: string | null }[];
  petitions: { id: string; title: string; support_count: number; threshold: number }[];
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_summary');
      if (error) throw new Error(error.message);
      return data as DashboardSummary;
    },
  });
}

// "This week" line inside the city summary panel.
export function WeekStrip({ d }: { d: DashboardSummary | undefined }) {
  const { t } = useT();
  if (!d) return null;
  const delta = d.reported_7d - d.reported_prev_7d;
  return (
    <div className="grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 text-xs">
      <p className="px-4 py-2.5 sm:px-5">
        <span className="block whitespace-nowrap text-white/70">{t('city.new7')}</span>
        <span className="flex items-center gap-1 text-base font-bold">+{d.reported_7d}
          {delta !== 0 && <span className={`flex items-center text-[11px] font-semibold ${delta > 0 ? 'text-amber-200' : 'text-emerald-200'}`} title="Compared with the week before">
            {delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(delta)}</span>}
        </span>
      </p>
      <p className="px-4 py-2.5 sm:px-5"><span className="block whitespace-nowrap text-white/70">{t('city.fixed7')}</span><span className="text-base font-bold">{d.fixed_7d}</span></p>
      <p className="px-4 py-2.5 sm:px-5"><span className="block whitespace-nowrap text-white/70">{t('city.avgFix')}</span><span className="text-base font-bold">{d.avg_days_to_fix == null ? 'n/a' : `${d.avg_days_to_fix} d`}</span></p>
    </div>
  );
}

// Personal panel: what needs the signed-in person's attention.
export function ForYouCard() {
  const { userId, profile } = useAuth();
  const { t } = useT();
  const mine = useQuery({
    queryKey: ['issues', 'mine', 'dash', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_issues').select(ISSUE_COLS);
      if (error) throw new Error(error.message);
      return data as unknown as Issue[];
    },
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  if (!userId || !profile) return null;
  const list = mine.data ?? [];
  const waiting = list.filter((i) => fixState(i) === 'waiting');
  const open = list.filter((i) => i.status === 'pending' || i.status === 'progress');

  return (
    <section className="card p-4" aria-labelledby="foryou-h">
      <h2 id="foryou-h" className="text-sm font-bold">{t('widget.forYou')}</h2>
      {waiting.length > 0 && (
        <Link to={`/issues/${waiting[0].id}`} className="mt-2 flex items-start gap-2 rounded-xl bg-[#e7f6ec] p-3 text-sm text-leaf hover:brightness-95">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span><b>Is it really fixed?</b> {waiting.length === 1 ? `“${waiting[0].title}” was marked fixed.` : `${waiting.length} of your reports were marked fixed.`} Please confirm.</span>
        </Link>
      )}
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Link to="/profile" className="rounded-lg p-2 hover:bg-sand"><dd className="text-xl font-bold">{open.length}</dd><dt className="text-[11px] text-muted">My open</dt></Link>
        <Link to="/profile" className="rounded-lg p-2 hover:bg-sand"><dd className="text-xl font-bold">{list.length - open.length}</dd><dt className="text-[11px] text-muted">Finished</dt></Link>
        <Link to="/profile" className="rounded-lg p-2 hover:bg-sand"><dd className="flex items-center justify-center gap-1 text-xl font-bold">{unread.data ?? 0}<Bell size={14} className="text-primary" /></dd><dt className="text-[11px] text-muted">Unread</dt></Link>
      </dl>
      {list.length === 0 && <p className="mt-1 text-xs text-muted">You have not reported anything yet. <Link to="/report" className="font-semibold text-primary underline">Report your first issue</Link></p>}
    </section>
  );
}

export function TrendingCard({ d }: { d: DashboardSummary | undefined }) {
  const { t } = useT();
  if (!d || d.trending.length === 0) return null;
  return (
    <section className="card p-4" aria-labelledby="trend-h">
      <h2 id="trend-h" className="flex items-center gap-1.5 text-sm font-bold"><Flame size={16} className="text-brick" /> {t('widget.trending')}</h2>
      <ol className="mt-1 divide-y divide-line">
        {d.trending.map((t, i) => (
          <li key={t.id}>
            <Link to={`/issues/${t.id}`} className="flex items-start gap-2.5 py-2 hover:text-primary">
              <span className="mt-0.5 w-4 shrink-0 text-center text-sm font-bold text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-semibold">{t.title}</span>
                <span className="flex items-center gap-2 text-[11px] text-muted"><span className={STATUS_CLASS[t.status]}>{STATUS_LABEL[t.status]}</span><ThumbsUp size={11} /> {t.upvote_count} · {ISSUE_CATEGORIES[t.category].split(' ')[0]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Before/after strip: proof that reporting works.
export function RecentlyFixed({ d }: { d: DashboardSummary | undefined }) {
  const { t } = useT();
  if (!d || d.recently_fixed.length === 0) return null;
  return (
    <section aria-labelledby="fixed-h" className="card p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="fixed-h" className="flex items-center gap-1.5 text-sm font-bold"><CheckCircle2 size={16} className="text-leaf" /> {t('widget.fixed')}</h2>
        <span className="text-[11px] text-muted">{t('widget.beforeAfter')}</span>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {d.recently_fixed.map((f) => (
          <li key={f.id} className="w-56 shrink-0">
            <Link to={`/issues/${f.id}`} className="block rounded-xl border border-line p-1.5 hover:border-leaf">
              <div className="grid grid-cols-2 gap-1">
                {[f.photo_path, f.resolved_photo_path].map((p, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-sand">
                    {p && <img src={photoUrl(p) ?? ''} alt={i ? 'After' : 'Before'} loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <span className={`absolute bottom-1 left-1 rounded px-1.5 py-px text-[10px] font-bold text-white ${i ? 'bg-leaf' : 'bg-ink/70'}`}>{i ? 'After' : 'Before'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 line-clamp-1 px-0.5 text-xs font-semibold">{f.title}</p>
              <p className="px-0.5 text-[10px] text-muted">{f.assignee ?? 'Fixed'} · {new Date(f.resolved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PetitionsCard({ d }: { d: DashboardSummary | undefined }) {
  if (!d || d.petitions.length === 0) return null;
  return (
    <section className="card p-4" aria-labelledby="pet-h">
      <div className="mb-1 flex items-center justify-between">
        <h2 id="pet-h" className="flex items-center gap-1.5 text-sm font-bold"><Megaphone size={15} className="text-primary" /> Petitions</h2>
        <Link to="/petitions" className="-my-2 inline-flex min-h-9 items-center px-1 text-xs font-semibold text-primary hover:underline">See all</Link>
      </div>
      <ul className="space-y-3">
        {d.petitions.map((p) => (
          <li key={p.id}>
            <Link to="/petitions" className="block hover:text-primary">
              <p className="line-clamp-2 text-sm font-semibold">{p.title}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (100 * p.support_count) / p.threshold)}%` }} /></div>
              <p className="mt-0.5 text-[11px] text-muted">{p.support_count} of {p.threshold} supporters</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Weather and air quality for Hyderabad from Open-Meteo (free, no key, CC BY 4.0).
const CITY = { name: 'Hyderabad', lat: 17.385, lng: 78.4867 };
const WMO: Record<number, string> = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
function aqiBand(v: number): { label: string; cls: string } {
  if (v <= 50) return { label: 'Good', cls: 'bg-emerald-100 text-emerald-800' };
  if (v <= 100) return { label: 'Moderate', cls: 'bg-amber-100 text-amber-800' };
  if (v <= 150) return { label: 'Unhealthy for sensitive groups', cls: 'bg-orange-100 text-orange-800' };
  if (v <= 200) return { label: 'Unhealthy', cls: 'bg-red-100 text-red-800' };
  return { label: 'Very unhealthy', cls: 'bg-purple-100 text-purple-800' };
}

export function WeatherCard() {
  const { centre } = useLocation2();
  // Rounded to about 1 km before it leaves the device.
  const at = centre
    ? { name: centre.source === 'place' ? centre.label : 'Your area', lat: Math.round(centre.lat * 100) / 100, lng: Math.round(centre.lng * 100) / 100 }
    : CITY;
  const w = useQuery({
    queryKey: ['weather', at.lat, at.lng],
    staleTime: 15 * 60_000,
    retry: 0,
    queryFn: async () => {
      const q = `latitude=${at.lat}&longitude=${at.lng}&timezone=Asia%2FKolkata`;
      const [f, a] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&forecast_days=1`).then((r) => r.json()),
        fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5`).then((r) => r.json()),
      ]);
      return {
        temp: Math.round(f.current.temperature_2m as number), code: f.current.weather_code as number, wind: Math.round(f.current.wind_speed_10m as number),
        rainChance: f.daily.precipitation_probability_max[0] as number, max: Math.round(f.daily.temperature_2m_max[0]), min: Math.round(f.daily.temperature_2m_min[0]),
        aqi: Math.round(a.current.us_aqi as number), pm25: Math.round(a.current.pm2_5 as number),
      };
    },
  });
  if (!w.data) return null;
  const d = w.data;
  const band = aqiBand(d.aqi);
  const Icon = d.code >= 51 ? CloudRain : Sun;
  return (
    <section className="card p-4" aria-label={`Weather in ${at.name}`}>
      <div className="flex items-center gap-3">
        <Icon size={30} className={d.code >= 51 ? 'text-primary' : 'text-amber-500'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{at.name} now</p>
          <p className="text-lg leading-tight font-bold">{d.temp}°C · {WMO[d.code] ?? 'Weather'}</p>
          <p className="text-[11px] text-muted">High {d.max}° / low {d.min}° · rain {d.rainChance}% · <Wind size={11} className="inline" /> {d.wind} km/h</p>
        </div>
      </div>
      <p className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold ${band.cls}`}>
        <span>Air quality: {band.label}</span><span>AQI {d.aqi} · PM2.5 {d.pm25}</span>
      </p>
      {d.rainChance >= 60 && <p className="mt-2 text-[11px] text-primary">Heavy rain likely. Report waterlogging or open drains to help crews respond.</p>}
      <p className="mt-2 text-[10px] text-muted">US AQI scale. Data: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">Open-Meteo</a> (CC BY 4.0)</p>
    </section>
  );
}
