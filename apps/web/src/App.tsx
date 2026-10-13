import { useEffect, useState } from 'react';
import type { HealthResponse } from '@jengalink/contracts';
import { JengaStyles } from '@jengalink/ui/web';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ErrorBoundary } from '@sentry/react';
import CrashScreen from './components/CrashScreen';
import DesignSystem from './DesignSystem';
import { AuthProvider } from './lib/auth';
import { LocaleRoot } from './lib/locale';
import { useAuth } from './lib/auth-context';
import AcceptProjectPage from './pages/AcceptProject';
import ClaimPage from './pages/Claim';
import InvitationsPage, { InvitationPage, InviteLinkPage } from './pages/Invitations';
import InviteOwnerPage from './pages/InviteOwner';
import MoneyPage, { ProjectMoneyPage } from './pages/Money';
import ChangesPage, { ChangePage } from './pages/Changes';
import ReportsPage, { ReportPage } from './pages/Reports';
import SharedReportPage from './pages/SharedReport';
import NotificationsPage from './pages/Notifications';
import ExportsPage from './pages/Exports';
import NewProjectPage from './pages/NewProject';
import NewUpdatePage from './pages/NewUpdate';
import HomePage from './pages/Home';
import QuotesPage, { QuoteEditorPage } from './pages/Quotes';
import ClaimsPage, { ClaimEditorPage } from './pages/Claims';
import SpendingPage, { SpendingRequestPage } from './pages/Spending';
import PaymentsPage from './pages/Payments';
import ProjectActivityPage, { StageTimelinePage } from './pages/ProjectActivity';
import ProjectsPage from './pages/Projects';
import StagePlanPage from './pages/StagePlan';
import Overview from './pages/Overview';
import SignIn from './pages/SignIn';
import UpdatesPage from './pages/Updates';
import Workspace from './pages/Workspace';
import './workspace.css';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function DesignRoute() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setError(true));
  }, []);
  return <DesignSystem apiStatus={error ? 'not reachable' : (health?.status ?? 'checking…')} />;
}

/** Workspace needs a session and a name; otherwise sign-in finishes first. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return null;
  // Remember where they were going (e.g. an invitation link) and return there after sign-in.
  if (status === 'signedOut' || !user?.displayName)
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return children;
}

const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Workspace />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'demo', element: <Overview /> },
      { path: 'money', element: <MoneyPage /> },
      { path: 'money/claims/:id', element: <ClaimPage /> },
      { path: 'updates', element: <UpdatesPage /> },
      { path: 'projects/new', element: <NewProjectPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id/plan', element: <StagePlanPage /> },
      { path: 'projects/:id/accept', element: <AcceptProjectPage /> },
      { path: 'projects/:id/updates/new', element: <NewUpdatePage /> },
      { path: 'projects/:id/updates', element: <ProjectActivityPage /> },
      { path: 'projects/:id/quotes', element: <QuotesPage /> },
      { path: 'projects/:id/quotes/:quoteId', element: <QuoteEditorPage /> },
      { path: 'projects/:id/claims', element: <ClaimsPage /> },
      { path: 'projects/:id/claims/:claimId', element: <ClaimEditorPage /> },
      { path: 'projects/:id/spending', element: <SpendingPage /> },
      { path: 'projects/:id/spending/:requestId', element: <SpendingRequestPage /> },
      { path: 'projects/:id/payments', element: <PaymentsPage /> },
      { path: 'projects/:id/money', element: <ProjectMoneyPage /> },
      { path: 'projects/:id/changes', element: <ChangesPage /> },
      { path: 'projects/:id/changes/:changeId', element: <ChangePage /> },
      { path: 'projects/:id/reports', element: <ReportsPage /> },
      { path: 'projects/:id/exports', element: <ExportsPage /> },
      { path: 'projects/:id/reports/:reportId', element: <ReportPage /> },
      { path: 'projects/:id/stages/:stageId', element: <StageTimelinePage /> },
      { path: 'projects/:id/invite', element: <InviteOwnerPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'invitations', element: <InvitationsPage /> },
      { path: 'invitations/:id', element: <InvitationPage /> },
    ],
  },
  {
    path: '/invite/:token',
    element: (
      <RequireAuth>
        <InviteLinkPage />
      </RequireAuth>
    ),
  },
  // A shared report link: public, no session; the API checks the token, scope and expiry.
  { path: '/s/:token', element: <SharedReportPage /> },
  { path: '/design', element: <DesignRoute /> },
]);

export default function App() {
  return (
    <>
      <JengaStyles />
      <AuthProvider>
        <LocaleRoot>
          <ErrorBoundary fallback={({ eventId, resetError }) => <CrashScreen eventId={eventId} onRetry={resetError} />}>
            <RouterProvider router={router} />
          </ErrorBoundary>
        </LocaleRoot>
      </AuthProvider>
    </>
  );
}
