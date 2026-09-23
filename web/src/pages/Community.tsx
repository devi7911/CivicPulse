import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Medal, Target } from 'lucide-react';
import { MissionList, useMissions } from '../components/ProfileExtras';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface Leader { display_name: string; verified: boolean; points: number }

// Missions to take part in, and the people who helped most this month.
export function Community() {
  const { userId, isGuest } = useAuth();
  const missions = useMissions();
  const leaders = useQuery({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('leaderboard');
      if (error) throw new Error(error.message);
      return data as Leader[];
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Community</p>
        <h1 className="page-title">Missions and <span className="marker">top helpers</span></h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Short challenges that make the neighbourhood better. Points count towards your tier and community rewards.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section className="card space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Target size={18} /> Missions</h2>
          {missions.isLoading ? <p className="text-sm text-muted">Loading…</p> : <MissionList missions={missions.data ?? []} />}
          {(!userId || isGuest) && <p className="text-xs text-muted"><Link to="/auth" state={{ mode: 'signup' }} className="font-semibold text-primary underline">Create an account</Link> to track mission progress and earn points.</p>}
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Medal size={18} /> Top helpers this month</h2>
          {leaders.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {leaders.data?.length === 0 && <p className="text-sm text-muted">No points earned yet this month. Be the first.</p>}
          <ol className="divide-y divide-line">
            {(leaders.data ?? []).map((l, i) => (
              <li key={`${l.display_name}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-primary text-white' : 'bg-sand text-ink'}`}>{i + 1}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-medium">{l.display_name}{l.verified && <BadgeCheck size={14} className="shrink-0 text-primary" aria-label="Verified" />}</span>
                <span className="font-semibold text-primary">{l.points} pts</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
