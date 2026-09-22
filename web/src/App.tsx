import { lazy, Suspense, type ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/AppShell';
import { isConfigured } from './lib/supabase';
import { Feed } from './pages/Feed';

// Every page except the home feed is downloaded only when it is first opened, to keep the first load small on phones.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const Admin = page(() => import('./pages/Admin'), 'Admin');
const Advertise = page(() => import('./pages/Advertise'), 'Advertise');
const Buses = page(() => import('./pages/Buses'), 'Buses');
const Auth = page(() => import('./pages/Auth'), 'Auth');
const Community = page(() => import('./pages/Community'), 'Community');
const Events = page(() => import('./pages/Events'), 'Events');
const IssueDetail = page(() => import('./pages/IssueDetail'), 'IssueDetail');
const OpenData = page(() => import('./pages/OpenData'), 'OpenData');
const Petitions = page(() => import('./pages/Petitions'), 'Petitions');
const Privacy = page(() => import('./pages/Legal'), 'Privacy');
const Profile = page(() => import('./pages/Profile'), 'Profile');
const ReportIssue = page(() => import('./pages/ReportIssue'), 'ReportIssue');
const ResetPassword = page(() => import('./pages/ResetPassword'), 'ResetPassword');
const Scorecard = page(() => import('./pages/Scorecard'), 'Scorecard');
const Terms = page(() => import('./pages/Legal'), 'Terms');
const Utilities = page(() => import('./pages/Utilities'), 'Utilities');
// Dev-only layout preview of the admin Overview; not registered in production builds.
const DevAdminPreview = import.meta.env.DEV ? page(() => import('./pages/DevAdminPreview'), 'DevAdminPreview') : null;

function SetupNeeded() {
  return (
    <div className="mx-auto max-w-md p-6 pt-16 text-center">
      <h1 className="text-xl font-bold">CivicPulse is almost ready</h1>
      <p className="mt-2 text-sm text-muted">
        Copy <code>web/.env.example</code> to <code>web/.env</code>, fill in your Supabase project URL and
        publishable key, then restart the dev server.
      </p>
    </div>
  );
}

// Staff land on their dashboard; "Public app" (/?view=public) still shows them the citizen feed.
function Home() {
  const { isAdmin, loading } = useAuth();
  const [params] = useSearchParams();
  if (!loading && isAdmin && params.get('view') !== 'public') return <Navigate to="/admin" replace />;
  return <Feed />;
}

const Loading = () => <p className="py-10 text-center text-sm text-muted">Loading…</p>;
const lazyEl = (C: ComponentType) => <Suspense fallback={<Loading />}><C /></Suspense>;

export function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="issues/:id" element={lazyEl(IssueDetail)} />
        <Route path="report" element={lazyEl(ReportIssue)} />
        <Route path="events" element={lazyEl(Events)} />
        <Route path="utilities" element={lazyEl(Utilities)} />
        <Route path="profile" element={lazyEl(Profile)} />
        <Route path="auth" element={lazyEl(Auth)} />
        <Route path="admin" element={lazyEl(Admin)} />
        <Route path="reset-password" element={lazyEl(ResetPassword)} />
        <Route path="scorecard" element={lazyEl(Scorecard)} />
        <Route path="community" element={lazyEl(Community)} />
        <Route path="petitions" element={lazyEl(Petitions)} />
        <Route path="open-data" element={lazyEl(OpenData)} />
        <Route path="advertise" element={lazyEl(Advertise)} />
        <Route path="buses" element={lazyEl(Buses)} />
        <Route path="privacy" element={lazyEl(Privacy)} />
        <Route path="terms" element={lazyEl(Terms)} />
        {DevAdminPreview && <Route path="dev/admin-preview" element={lazyEl(DevAdminPreview)} />}
        <Route path="*" element={
          <div className="py-16 text-center">
            <h1 className="page-title">Page not found</h1>
            <p className="mt-1 text-sm text-muted">The link may be old, or the report may have been removed.</p>
            <Link to="/" className="btn btn-primary mt-4">Go to home</Link>
          </div>
        } />
      </Route>
    </Routes>
  );
}
