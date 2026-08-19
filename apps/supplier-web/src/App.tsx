import { QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import type { Capability } from '@tmmin-henkaten/contracts';

import { queryClient } from './app/query';
import { PwaLifecycle } from './app/pwa';
import { PushProvider } from './app/push';
import { rememberIntendedPath, SessionProvider, useSession } from './app/session';
import { ProductLayout } from './components/layout';
import { AccountPage, ChangePasswordPage, LoginPage } from './pages/AuthPages';
import { AuditPage, NotificationsPage } from './pages/ActivityPages';
import { BoardPage } from './pages/BoardPage';
import { DefaultAssignmentsPage } from './pages/DefaultAssignmentsPage';
import { HenkatenCreatePage, HenkatenDetailPage, HenkatenListPage } from './pages/HenkatenPages';
import {
  ChecklistDetailPage,
  ChecklistOverviewPage,
  MasterDataOverviewPage,
  MasterFormPage,
  MasterListPage,
} from './pages/MasterDataPages';
import { OverviewPage } from './pages/OverviewPage';
import { SetupPage } from './pages/SetupPage';
import {
  PrepareShiftPage,
  ShiftDetailPage,
  ShiftListPage,
  ShiftResolutionPage,
} from './pages/ShiftPages';
import { AppLoading, ForbiddenPage, NotFoundPage, RouteErrorPage } from './pages/StatePages';

const DesignSystemShowcase = lazy(() =>
  import('@tmmin-henkaten/ui/showcase').then((module) => ({
    default: module.DesignSystemShowcase,
  })),
);

export function App() {
  if (window.location.pathname === '/design') return <DesignRoute />;
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <PushProvider>
            <ProductRoutes />
            <PwaLifecycle />
          </PushProvider>
        </SessionProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

function ProductRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AnonymousRoute>
            <LoginPage />
          </AnonymousRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <AuthenticatedRoute allowForced>
            <ChangePasswordPage />
          </AuthenticatedRoute>
        }
      />
      <Route
        element={
          <AuthenticatedRoute>
            <ProductLayout />
          </AuthenticatedRoute>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route
          path="setup"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <SetupPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="board"
          element={
            <CapabilityRoute capability="SUPPLIER_BOARD_READ">
              <BoardPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens"
          element={
            <CapabilityRoute capability="SUPPLIER_HENKATEN_READ">
              <HenkatenListPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens/new"
          element={
            <CapabilityRoute capability="SUPPLIER_HENKATEN_SUBMIT">
              <HenkatenCreatePage />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens/:henkatenId/clone"
          element={
            <CapabilityRoute capability="SUPPLIER_HENKATEN_SUBMIT">
              <HenkatenCreatePage clone />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens/:henkatenId"
          element={
            <CapabilityRoute capability="SUPPLIER_HENKATEN_READ">
              <HenkatenDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="approvals"
          element={
            <CapabilityRoute capability="SUPPLIER_HENKATEN_DECIDE">
              <HenkatenListPage approvalQueue />
            </CapabilityRoute>
          }
        />
        <Route
          path="shifts"
          element={
            <CapabilityRoute capability="SUPPLIER_SHIFT_READ">
              <ShiftListPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="shifts/prepare"
          element={
            <CapabilityRoute capability="SUPPLIER_SHIFT_OPERATE">
              <PrepareShiftPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="shifts/:shiftRunId/resolve"
          element={
            <CapabilityRoute capability="SUPPLIER_SHIFT_READ">
              <ShiftResolutionPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="shifts/:shiftRunId"
          element={
            <CapabilityRoute capability="SUPPLIER_SHIFT_READ">
              <ShiftDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <CapabilityRoute capability="SUPPLIER_NOTIFICATION_READ">
              <NotificationsPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <MasterDataOverviewPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/members"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <MasterListPage kind="members" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/members/new"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="members" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/members/:resourceId"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="members" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/lines"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <MasterListPage kind="lines" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/lines/new"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="lines" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/lines/:resourceId"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="lines" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/parts"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <MasterListPage kind="parts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/parts/new"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="parts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/parts/:resourceId"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="parts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/shifts"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <MasterListPage kind="shifts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/shifts/new"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="shifts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/shifts/:resourceId"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <MasterFormPage kind="shifts" />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/checklists"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_READ" allowPreparation>
              <ChecklistOverviewPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/checklists/:category"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <ChecklistDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="master-data/default-assignments"
          element={
            <CapabilityRoute capability="SUPPLIER_MASTER_DATA_MANAGE" allowPreparation>
              <DefaultAssignmentsPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="audit"
          element={
            <CapabilityRoute capability="SUPPLIER_AUDIT_READ">
              <AuditPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="account"
          element={
            <CapabilityRoute capability="SUPPLIER_SELF_SERVICE" allowPreparation>
              <AccountPage />
            </CapabilityRoute>
          }
        />
        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function HomeRoute() {
  const { session } = useSession();
  if (session?.principal.purpose === 'HOSTED_PREPARATION') return <Navigate to="/setup" replace />;
  return (
    <CapabilityRoute capability="SUPPLIER_DASHBOARD_READ">
      <OverviewPage />
    </CapabilityRoute>
  );
}

function AnonymousRoute({ children }: { children: ReactNode }) {
  const { status, session } = useSession();
  if (status === 'loading') return <AppLoading />;
  if (status === 'authenticated' && session)
    return (
      <Navigate
        to={
          session.principal.mustChangePassword
            ? '/change-password'
            : session.principal.purpose === 'HOSTED_PREPARATION'
              ? '/setup'
              : '/'
        }
        replace
      />
    );
  return children;
}

function AuthenticatedRoute({
  children,
  allowForced = false,
}: {
  children: ReactNode;
  allowForced?: boolean;
}) {
  const { status, session } = useSession();
  const location = useLocation();
  if (status === 'loading') return <AppLoading />;
  if (status === 'anonymous' || !session) {
    rememberIntendedPath(`${location.pathname}${location.search}`);
    return (
      <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />
    );
  }
  if (session.principal.mustChangePassword && !allowForced)
    return <Navigate to="/change-password" replace />;
  return children;
}

function CapabilityRoute({
  capability,
  allowPreparation = false,
  children,
}: {
  capability: Capability;
  allowPreparation?: boolean;
  children: ReactNode;
}) {
  const { session, hasCapability } = useSession();
  if (!session || !hasCapability(capability)) return <ForbiddenPage />;
  if (session.principal.purpose === 'HOSTED_PREPARATION' && !allowPreparation)
    return <ForbiddenPage />;
  return children;
}

function DesignRoute() {
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow';
    document.head.append(robots);
    document.title = 'Henkaten Design System · Sample data';
    return () => robots.remove();
  }, []);
  return (
    <Suspense
      fallback={
        <main className="design-loading">
          <span />
          <p role="status">Memuat Henkaten Design System…</p>
        </main>
      }
    >
      <DesignSystemShowcase />
    </Suspense>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info);
  }
  override render() {
    return this.state.failed ? <RouteErrorPage /> : this.props.children;
  }
}
