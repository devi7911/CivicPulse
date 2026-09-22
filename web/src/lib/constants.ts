import type { ClosedReason, EventCategory, Issue, IssueCategory, IssueStatus } from './types';

export const COMMENT_LIMIT = 3;

export const ISSUE_CATEGORIES: Record<IssueCategory, string> = {
  roads: 'Roads & Transport',
  waste: 'Sanitation & Waste',
  lighting: 'Street Lighting',
  water: 'Water Supply',
  parks: 'Parks & Facilities',
  other: 'Other',
};

// Every query on issues must list columns: the reporter's id is not readable, so '*' fails.
export const ISSUE_COLS =
  'id, ref_no, public_author_id, anonymous, confidential, title, description, category, status, photo_path, ' +
  'resolved_photo_path, lat, lng, location_text, priority_score, severity, assignee, upvote_count, comment_count, ' +
  'created_at, updated_at, target_date, closed_reason, closed_note, resolved_at, verdict, reopen_count, hidden, hidden_reason, area, video_path';
export const ISSUE_SELECT = `${ISSUE_COLS}, author:profiles!issues_public_author_id_fkey(display_name, verified, avatar_path)`;

export const STATUS_LABEL: Record<IssueStatus, string> = {
  pending: 'Pending review',
  progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed, not fixed',
};

export const CLOSED_REASONS: Record<ClosedReason, string> = {
  private_land: 'On private property',
  other_agency: 'Handled by another agency',
  no_budget: 'No budget right now',
  not_an_issue: 'Not a problem on inspection',
  duplicate: 'Duplicate of another report',
};

// One-tap details per category, so people can describe a problem without typing much.
export const QUICK_DETAILS: Record<IssueCategory, string[]> = {
  roads: ['Pothole', 'Broken footpath', 'Open manhole', 'Waterlogging', 'Missing speed breaker sign', 'Damaged divider'],
  waste: ['Garbage not collected', 'Overflowing bin', 'Construction debris dumped', 'Burning garbage', 'Dead animal'],
  lighting: ['Street light not working', 'Light on during the day', 'Exposed wires', 'Leaning pole'],
  water: ['Pipeline leak', 'No water supply', 'Dirty water', 'Sewage overflow', 'Blocked drain'],
  parks: ['Broken play equipment', 'Overgrown grass', 'Park lights off', 'Unsafe wall or fence'],
  other: ['Stray animals', 'Illegal encroachment', 'Public toilet unusable', 'Noise nuisance'],
};

export const FIX_RESPONSE_DAYS = 7;

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function isOverdue(i: Pick<Issue, 'status' | 'target_date'>): boolean {
  return (i.status === 'pending' || i.status === 'progress') && !!i.target_date && i.target_date < todayIST();
}

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A resolved report is treated as confirmed once the reporter's 7-day window has passed.
export function fixState(i: Pick<Issue, 'status' | 'verdict' | 'resolved_at'>): 'waiting' | 'confirmed' | 'auto' | null {
  if (i.status !== 'resolved' || !i.resolved_at) return null;
  if (i.verdict === 'accepted') return 'confirmed';
  const deadline = new Date(i.resolved_at).getTime() + FIX_RESPONSE_DAYS * 86_400_000;
  return Date.now() > deadline ? 'auto' : 'waiting';
}

export const STATUS_CLASS: Record<IssueStatus, string> = {
  pending: 'status status-pending',
  progress: 'status status-progress',
  resolved: 'status status-resolved',
  closed: 'status status-closed',
};

export const EVENT_CATEGORIES: Record<EventCategory, string> = {
  public_health: 'Public health',
  civic_action: 'Civic action',
  animal_welfare: 'Animal welfare',
  children: "Children's events",
};

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatEventTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const t = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return `${day}, ${t(start)} to ${t(end)} IST`;
}

// Only ever open https links, even though the database also enforces this.
export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
