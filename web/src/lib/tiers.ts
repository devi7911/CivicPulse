import type { Tier } from './types';

export interface TierProgress {
  current: Tier;
  next: Tier | null;
  percent: number;
  pointsToNext: number;
}

export function tierProgress(tiers: Tier[], points: number): TierProgress | null {
  if (tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.min_points - b.min_points);
  let idx = 0;
  sorted.forEach((t, i) => { if (points >= t.min_points) idx = i; });
  const current = sorted[idx];
  const next = sorted[idx + 1] ?? null;
  if (!next) return { current, next: null, percent: 100, pointsToNext: 0 };
  const span = next.min_points - current.min_points;
  const percent = Math.min(100, Math.round(((points - current.min_points) / span) * 100));
  return { current, next, percent, pointsToNext: next.min_points - points };
}
