import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Tier } from '../lib/types';

export function useTiers() {
  return useQuery({
    queryKey: ['tiers'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('tiers').select('*').order('min_points');
      if (error) throw new Error(error.message);
      return data as Tier[];
    },
  });
}
