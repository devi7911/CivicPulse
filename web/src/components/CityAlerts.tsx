import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Info } from 'lucide-react';
import { safeHttps } from '../lib/constants';
import { supabase } from '../lib/supabase';

export interface CityAlert {
  id: string; kind: string; severity: 'info' | 'warning' | 'danger'; title: string; body: string;
  area: string | null; link: string | null; starts_at: string; ends_at: string;
}

export function useActiveAlerts() {
  return useQuery({
    queryKey: ['city-alerts', 'active'],
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('city_alerts').select('id, kind, severity, title, body, area, link, starts_at, ends_at')
        .lte('starts_at', now).gt('ends_at', now).order('starts_at', { ascending: false }).limit(5);
      if (error) throw new Error(error.message);
      return data as CityAlert[];
    },
  });
}

const TONE = {
  danger: 'border-brick/30 bg-blush text-brick',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-primary/20 bg-primary-soft text-primary',
};

// Floods, power or water cuts and traffic alerts published by the city team.
export function CityAlerts() {
  const alerts = useActiveAlerts();
  if (!alerts.data?.length) return null;
  return (
    <section aria-label="City alerts" className="space-y-2">
      {alerts.data.map((a) => {
        const link = safeHttps(a.link);
        return (
          <div key={a.id} role={a.severity === 'danger' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border p-3 text-sm ${TONE[a.severity]}`}>
            {a.severity === 'info' ? <Info size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <p className="font-bold">{a.title}{a.area ? ` · ${a.area}` : ''}</p>
              <p className="text-ink/80">{a.body}</p>
              <p className="mt-0.5 text-[11px] opacity-80">
                Until {new Date(a.ends_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST
                {link && <> · <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold underline">More info <ExternalLink size={11} /></a></>}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
