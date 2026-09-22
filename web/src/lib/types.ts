export type Role = 'citizen' | 'admin';
export type IssueCategory = 'roads' | 'waste' | 'lighting' | 'water' | 'parks' | 'other';
export type IssueStatus = 'pending' | 'progress' | 'resolved' | 'closed';
export type ClosedReason = 'private_land' | 'other_agency' | 'no_budget' | 'not_an_issue' | 'duplicate';
export type Severity = 'low' | 'medium' | 'high';
export type EventCategory = 'public_health' | 'civic_action' | 'animal_welfare' | 'children';

export interface Profile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  role: Role;
  verified: boolean;
  points: number;
  account_type: import('./accounts').AccountType;
  org_name: string | null;
}

export interface ProfilePrivate {
  id: string;
  phone: string | null;
  address: string | null;
  area: string | null;
}

export interface Tier {
  name: string;
  min_points: number;
  title: string;
  community_reward: string;
}

export interface Issue {
  id: string;
  ref_no: string;
  // The real reporter is private. This is empty for anonymous reports.
  public_author_id: string | null;
  anonymous: boolean;
  confidential: boolean;
  target_date: string | null;
  closed_reason: ClosedReason | null;
  closed_note: string | null;
  resolved_at: string | null;
  verdict: 'accepted' | 'rejected' | null;
  reopen_count: number;
  distance_m?: number; // added in the app for "near" feeds, not a database column
  updated_at?: string;
  area?: string | null;
  video_path?: string | null;
  hidden?: boolean;
  hidden_reason?: string | null;
  title: string;
  description: string;
  category: IssueCategory;
  status: IssueStatus;
  photo_path: string | null;
  resolved_photo_path: string | null;
  lat: number | null;
  lng: number | null;
  location_text: string;
  priority_score: number;
  severity: Severity;
  assignee: string | null;
  upvote_count: number;
  comment_count: number;
  created_at: string;
  author?: Pick<Profile, 'display_name' | 'verified' | 'avatar_path'> | null;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
  hidden?: boolean;
  author?: Pick<Profile, 'display_name' | 'role' | 'verified' | 'account_type' | 'org_name'> | null;
}

export interface TimelineEntry {
  id: string;
  status: IssueStatus;
  title: string;
  note: string;
  created_at: string;
}

export interface CityEvent {
  id: string;
  title: string;
  description: string;
  category: EventCategory;
  child_friendly: boolean;
  organizer: string;
  location_text: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  rsvp_count: number;
  children_count: number;
}

export interface SponsoredPost {
  id: string;
  title: string;
  body: string;
  media_path: string | null;
  media_type: 'image' | 'gif' | 'video' | null;
  ngo: { name: string; donate_url: string; website: string | null } | null;
  // Set for self-serve marketplace campaigns; house ads from admins leave these out.
  cta_label?: string;
  campaign?: boolean;
  verified?: boolean;
}

export interface Helpline {
  id: string;
  name: string;
  phone: string;
  kind: 'helpline' | 'police_station';
  area: string | null;
  address: string | null;
}

export interface UtilityLink {
  id: string;
  category: string;
  title: string;
  description: string;
  url: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
}

export interface AppNotification {
  id: string;
  issue_id: string | null;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface IssuePhoto {
  id: string;
  user_id: string;
  path: string;
  created_at: string;
}

export interface NearbyIssue {
  id: string;
  ref_no: string;
  title: string;
  status: IssueStatus;
  upvote_count: number;
  distance_m: number;
  photo_path: string | null;
}

export interface DepartmentScore {
  department: string;
  total: number;
  open: number;
  resolved: number;
  closed: number;
  overdue: number;
  reopened: number;
  avg_days_to_fix: number | null;
  on_time_pct: number | null;
  confirmed_pct: number | null;
}
