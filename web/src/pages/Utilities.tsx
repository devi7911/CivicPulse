import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Phone, ShieldAlert } from 'lucide-react';
import { CityAlerts } from '../components/CityAlerts';
import { useAuth } from '../hooks/useAuth';
import { safeHttps } from '../lib/constants';
import { supabase } from '../lib/supabase';
import type { Helpline, UtilityLink } from '../lib/types';

const LINK_GROUPS: Record<string, string> = {
  electricity: 'Electricity bill',
  challan: 'Vehicle challan',
  water: 'Water bill',
  property_tax: 'Property tax',
  other: 'Other services',
};

export function Utilities() {
  const { userId } = useAuth();

  const area = useQuery({
    queryKey: ['my-area', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_private').select('area').eq('id', userId!).single();
      if (error) throw new Error(error.message);
      return (data.area as string | null) ?? null;
    },
  });

  const helplines = useQuery({
    queryKey: ['helplines'],
    queryFn: async () => {
      const { data, error } = await supabase.from('helplines').select('*').order('sort').order('name');
      if (error) throw new Error(error.message);
      return data as Helpline[];
    },
  });

  const links = useQuery({
    queryKey: ['utility-links'],
    queryFn: async () => {
      const { data, error } = await supabase.from('utility_links').select('*').order('sort');
      if (error) throw new Error(error.message);
      return data as UtilityLink[];
    },
  });

  const all = helplines.data ?? [];
  const myArea = area.data?.toLowerCase() ?? null;
  const stations = all.filter((h) => h.kind === 'police_station');
  const nearby = myArea ? stations.filter((s) => s.area?.toLowerCase() === myArea) : [];
  const national = all.filter((h) => h.kind === 'helpline');

  const grouped = (links.data ?? []).reduce<Record<string, UtilityLink[]>>((acc, l) => {
    (acc[l.category in LINK_GROUPS ? l.category : 'other'] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-5 lg:space-y-0">
      <div className="lg:col-span-2"><p className="label">Help and services</p><h1 className="page-title">Utilities &amp; <span className="marker">quick links</span></h1></div>
      <div className="empty:hidden lg:col-span-2"><CityAlerts /></div>

      <section aria-labelledby="emergency-h" className="space-y-2">
        <h2 id="emergency-h" className="flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={18} className="text-brick" /> Emergency contacts</h2>

        {myArea && nearby.length > 0 && (
          <ul className="space-y-2">
            {nearby.map((s) => <ContactRow key={s.id} h={s} highlight />)}
          </ul>
        )}
        {userId && !myArea && <p className="text-xs text-muted">Add your area in Profile to see your nearest police station here.</p>}
        {myArea && nearby.length === 0 && <p className="text-xs text-muted">No police station is listed for your area yet. Use the numbers below.</p>}

        <ul className="stagger space-y-2 2xl:grid 2xl:grid-cols-2 2xl:gap-2 2xl:space-y-0">
          {national.map((h) => <ContactRow key={h.id} h={h} />)}
        </ul>
      </section>

      <section aria-labelledby="pay-h" className="space-y-3">
        <h2 id="pay-h" className="text-lg font-semibold">Civic payments</h2>
        <p className="text-xs text-muted">These open the official government portals in a new tab. CivicPulse does not process payments or see your details.</p>
        {links.isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!links.isLoading && (links.data?.length ?? 0) === 0 && <p className="text-sm text-muted">Payment links have not been added yet.</p>}
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <h3 className="label">{LINK_GROUPS[cat]}</h3>
            <ul className="space-y-2 3xl:grid 3xl:grid-cols-2 3xl:gap-2 3xl:space-y-0">
              {items.map((l) => {
                const href = safeHttps(l.url);
                if (!href) return null;
                return (
                  <li key={l.id}>
                    <a href={href} target="_blank" rel="noopener noreferrer" className="card-flat flex items-center justify-between gap-3 p-3 transition hover:bg-primary-soft">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{l.title}</span>
                        <span className="block truncate text-xs text-muted">{new URL(href).hostname}</span>
                      </span>
                      <ExternalLink size={16} className="shrink-0 text-muted" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function ContactRow({ h, highlight = false }: { h: Helpline; highlight?: boolean }) {
  return (
    <li className={`card-flat flex items-center justify-between gap-3 p-3 ${highlight ? 'bg-primary-soft' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{h.name}</span>
        <span className="block truncate text-xs text-muted">{h.address ?? (h.kind === 'police_station' ? h.area ?? 'Police station' : 'National helpline')}</span>
      </span>
      <a href={`tel:${h.phone.replace(/[^0-9+]/g, '')}`} className="btn btn-primary min-h-10 shrink-0 px-3" aria-label={`Call ${h.name} on ${h.phone}`}>
        <Phone size={15} /> {h.phone}
      </a>
    </li>
  );
}
