import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AdminDashboard, type Dashboard } from '../components/AdminDashboard';
import type { Overview } from '../components/AdminOverview';

// Local development only (the route is not registered in production builds).
// Renders the admin dashboard from a snapshot of admin_dashboard / admin_overview taken on 22 Sep 2026,
// limited to the fictional seed accounts, so the layout can be reviewed before an admin account exists.
// It never calls the admin-only database functions.
const OVERVIEW: Overview = {
  ads: 0, flags: 0, verify: 2, overdue: 2, due_soon: 0, reopened: 0, petitions: 0, sightings: 0, errors_24h: 0, signups_7d: 1,
  unassigned: 3, unpaid_ads: 0, open_issues: 6, reports_24h: 11, resolved_7d: 4, child_expiring: 0, routes_without_stops: 0,
  claimed_now: 0, pending_count: 3, progress_count: 3, oldest_open_days: 1, activity: [],
};

const MAP: Dashboard['map'] = [
  { id: 'c6f90fa0-7b03-44b2-b4c1-d2a47bc5a4e6', lat: 17.443, lng: 78.389, area: 'Madhapur', title: 'Street lights off on 100 Feet Road', ref_no: 'CP-26-000043', status: 'progress', category: 'lighting', severity: 'low', target_date: '2026-09-18', upvote_count: 2, location_text: '100 Feet Road, Madhapur' },
  { id: '11997f65-dea0-4cc7-ae8a-eafea7c16492', lat: 17.47, lng: 78.44, area: 'Balanagar', title: 'Sewage overflowing into lane', ref_no: 'CP-26-000049', status: 'progress', category: 'water', severity: 'medium', target_date: '2026-09-15', upvote_count: 1, location_text: 'Balanagar, Kukatpally' },
  { id: '06bdbf60-766e-47a7-9bbb-bb49acbe8b33', lat: 17.4504, lng: 78.3808, area: 'Madhapur', title: 'Deep pothole outside Cyber Towers', ref_no: 'CP-26-000042', status: 'progress', category: 'roads', severity: 'medium', target_date: '2026-09-26', upvote_count: 3, location_text: 'Cyber Towers, Madhapur' },
  { id: '5ebe40e9-7799-4837-8821-249a842ff238', lat: 17.441, lng: 78.392, area: 'Madhapur', title: 'Light on during the day', ref_no: 'CP-26-000050', status: 'pending', category: 'lighting', severity: 'low', target_date: null, upvote_count: 0, location_text: 'Metro pillar 1450, Madhapur' },
  { id: '9dfddfde-bc6e-48e5-ae3d-052e68b6225c', lat: 17.46, lng: 78.364, area: 'Kondapur', title: 'Construction debris dumped', ref_no: 'CP-26-000051', status: 'pending', category: 'waste', severity: 'low', target_date: null, upvote_count: 0, location_text: 'Kondapur main road' },
  { id: '10fff475-6def-4e06-a1f6-e5626746b1a3', lat: 17.3946584027067, lng: 78.536266922297, area: 'Ramanthapur', title: 'Deep pothole near the main bus stop', ref_no: 'CP-26-000007', status: 'pending', category: 'roads', severity: 'medium', target_date: null, upvote_count: 0, location_text: 'Ramanthapur' },
];

function snapshot(days: number): Dashboard {
  const end = new Date('2026-09-22T12:00:00+05:30');
  const daily = Array.from({ length: days }, (_, i) => {
    const day = new Date(end.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const last = i === days - 1, prev = i === days - 2;
    return { day, reported: last ? 10 : prev ? 1 : 0, resolved: last ? 4 : 0, signups: last ? 1 : 0, backlog: last ? 6 : prev ? 1 : 0 };
  });
  return {
    from: daily[0].day, to: daily[daily.length - 1].day, days, daily,
    areas: ['Balanagar', 'HITEC City', 'Jubilee Hills', 'Kondapur', 'Kukatpally', 'Madhapur', 'Ramanthapur', 'Tolichowki'],
    kpis: { reports: [11, 0], resolved: [4, 0], signups: [1, 0], days_to_fix: [0, null], on_time: [75, null], satisfaction: [100, null],
      first_response_h: [0, null], active_people: [6, 0], returning_pct: [0, null] },
    heat: [[1, 17, 1], [2, 1, 10]],
    status: { pending: 3, progress: 3, resolved: 4, closed: 1 },
    severity_open: { low: 3, medium: 3 },
    category_open: { roads: 2, lighting: 2, waste: 1, water: 1 },
    verdicts: { accepted: 1, rejected: 0, waiting: 3 },
    map: MAP,
    departments: [
      { department: 'GHMC Electrical', open: 1, overdue: 1, resolved: 0, resolved_prev: 0, avg_days: null, on_time: null, on_time_prev: null, rejected: 0 },
      { department: 'GHMC Roads', open: 1, overdue: 0, resolved: 1, resolved_prev: 0, avg_days: 0, on_time: 100, on_time_prev: null, rejected: 0 },
      { department: 'HMWSSB (Water Board)', open: 1, overdue: 1, resolved: 1, resolved_prev: 0, avg_days: 0, on_time: 0, on_time_prev: null, rejected: 0 },
      { department: 'GHMC Parks', open: 0, overdue: 0, resolved: 1, resolved_prev: 0, avg_days: 0, on_time: 100, on_time_prev: null, rejected: 0 },
      { department: 'GHMC Sanitation', open: 0, overdue: 0, resolved: 1, resolved_prev: 0, avg_days: 0, on_time: 100, on_time_prev: null, rejected: 0 },
    ],
    top_open: [
      { id: MAP[5].id, ref_no: 'CP-26-000007', title: 'Deep pothole near the main bus stop', upvote_count: 0, area: 'Ramanthapur', severity: 'medium', assignee: null, age_days: 1 },
      { id: MAP[1].id, ref_no: 'CP-26-000049', title: 'Sewage overflowing into lane', upvote_count: 1, area: 'Balanagar', severity: 'medium', assignee: 'HMWSSB (Water Board)', age_days: 0 },
      { id: MAP[2].id, ref_no: 'CP-26-000042', title: 'Deep pothole outside Cyber Towers', upvote_count: 3, area: 'Madhapur', severity: 'medium', assignee: 'GHMC Roads', age_days: 0 },
      { id: MAP[4].id, ref_no: 'CP-26-000051', title: 'Construction debris dumped', upvote_count: 0, area: 'Kondapur', severity: 'low', assignee: null, age_days: 0 },
      { id: MAP[0].id, ref_no: 'CP-26-000043', title: 'Street lights off on 100 Feet Road', upvote_count: 2, area: 'Madhapur', severity: 'low', assignee: 'GHMC Electrical', age_days: 0 },
      { id: MAP[3].id, ref_no: 'CP-26-000050', title: 'Light on during the day', upvote_count: 0, area: 'Madhapur', severity: 'low', assignee: null, age_days: 0 },
    ],
    stale_unassigned: [
      { id: MAP[5].id, ref_no: 'CP-26-000007', title: 'Deep pothole near the main bus stop', area: 'Ramanthapur', age_days: 1 },
      { id: MAP[3].id, ref_no: 'CP-26-000050', title: 'Light on during the day', area: 'Madhapur', age_days: 0 },
      { id: MAP[4].id, ref_no: 'CP-26-000051', title: 'Construction debris dumped', area: 'Kondapur', age_days: 0 },
    ],
    due_soon: [],
    reopened: [],
    most_backed_week: [
      { id: MAP[2].id, ref_no: 'CP-26-000042', title: 'Deep pothole outside Cyber Towers', new_upvotes: 3 },
      { id: 'f68a0da8-ab91-48b6-ac71-aa173f0078ab', ref_no: 'CP-26-000047', title: 'Open manhole on footpath', new_upvotes: 3 },
      { id: MAP[0].id, ref_no: 'CP-26-000043', title: 'Street lights off on 100 Feet Road', new_upvotes: 2 },
      { id: MAP[1].id, ref_no: 'CP-26-000049', title: 'Sewage overflowing into lane', new_upvotes: 1 },
      { id: '5b10f10b-aae7-47b1-81fe-4d174a09a590', ref_no: 'CP-26-000044', title: 'Garbage not collected for a week', new_upvotes: 1 },
    ],
    child_alerts: [{ id: 'ebc3c208-01a7-4aba-9c15-c074bf9536aa', first_name: 'Ananya', age: 8, last_seen_place: 'Ameerpet metro station, exit B', expires_at: '2026-10-21T21:05:53Z', sightings: 0 }],
    city_alerts: [{ id: 'e4a4b930-e67a-49ac-86d6-b6431e71ca22', kind: 'water', severity: 'warning', title: 'Water supply cut on Thursday', area: 'Kukatpally, KPHB', ends_at: '2026-09-24T12:30:00Z' }],
    engagement: { comments: 6, upvotes: 10, rsvps: 2, contributions: 4, events_upcoming: 5 },
    top_contributors: [
      { id: '46490462-643c-471d-8936-fe2f3f59e099', display_name: 'Fatima Khan', org_name: 'Tolichowki Residents Welfare Association', account_type: 'community', verified: true, points: 100 },
      { id: '96c07731-1192-4dae-95a5-d460916dca2f', display_name: 'Venkat Naidu', org_name: null, account_type: 'individual', verified: true, points: 100 },
      { id: 'd2ef3785-3734-4e94-a97b-7f780472ebef', display_name: 'Priya Reddy', org_name: null, account_type: 'individual', verified: true, points: 100 },
      { id: 'fa947cfa-4287-4e7c-a9cd-66374997b4a4', display_name: 'Arjun Rao', org_name: null, account_type: 'individual', verified: false, points: 100 },
      { id: 'c80ea442-af1b-42f8-8660-167fd1098cd7', display_name: 'K. Srinivas', org_name: 'GHMC Serilingampally Circle', account_type: 'government', verified: true, points: 5 },
    ],
    petitions_near: [],
    events_watch: [],
    people: { total: 9, verified: 5, banned: 0, by_type: { individual: 5, community: 2, ngo: 1, government: 1 }, guest_report_pct: 0 },
    verification: { requested: 2, approved: 0, rejected: 0, pending: 2, avg_review_h: null },
    ads: { live: 1, views: 1, clicks: 1, paid_inr: 2000, unpaid: [], ending_soon: [], weekly: [{ week: '2026-09-21', inr: 2000 }] },
    health: { errors_daily: daily.map((x) => ({ day: x.day, n: 0 })), top_errors: [], db_bytes: 15_813_779, storage_bytes: 0, push_devices: 0, push_failed_recent: 0, routes_without_stops: 0 },
    admins: [],
  };
}

export function DevAdminPreview() {
  const qc = useQueryClient();
  useState(() => {
    qc.setQueryDefaults(['admin-overview'], { staleTime: Infinity, refetchInterval: false, enabled: false });
    qc.setQueryData(['admin-overview'], OVERVIEW);
  });
  return (
    <div className="space-y-5">
      <p role="note" className="rounded-lg border border-line bg-sand px-3 py-2 text-xs font-semibold">
        Local preview with a snapshot of today's data (area, category and custom-date filters are not applied here). The real page is at /admin and needs an admin sign-in.
      </p>
      <div><p className="label">Staff only</p><h1 className="page-title">Admin <span className="marker">dashboard</span></h1></div>
      <AdminDashboard snapshot={(f) => snapshot(f.days)} onOpen={(t) => alert(`In the real console this opens the “${t}” tab.`)} />
    </div>
  );
}
