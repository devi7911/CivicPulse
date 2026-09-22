import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Overview {
  verify: number; flags: number; ads: number; sightings: number; petitions: number; support_open: number;
  overdue: number; unassigned: number; open_issues: number; reports_24h: number; resolved_7d: number;
  signups_7d: number; errors_24h: number;
  child_expiring: number; due_soon: number; reopened: number; unpaid_ads: number; routes_without_stops: number;
  claimed_now: number; pending_count: number; progress_count: number; oldest_open_days: number;
  activity: { action: string; target_type: string; title: string | null; created_at: string; actor: string | null }[];
}

export function useAdminOverview(enabled = true) {
  return useQuery({
    queryKey: ['admin-overview'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_overview');
      if (error) throw new Error(error.message);
      return data as Overview;
    },
    refetchInterval: 60_000,
  });
}

// Queue name -> which Overview count shows as its badge.
export const BADGE: Partial<Record<string, keyof Overview>> = {
  issues: 'overdue', verify: 'verify', moderation: 'flags', ads: 'ads', child: 'sightings', petitions: 'petitions', errors: 'errors_24h', support: 'support_open',
};
