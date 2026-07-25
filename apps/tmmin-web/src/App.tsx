import { QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import type { Capability } from '@tmmin-henkaten/contracts';

import { queryClient } from './app/query';
import { rememberIntendedPath, TmminSessionProvider, useTmminSession } from './app/session';
import { TmminLayout } from './components/layout';
import {
  ExternalCredentialsPage,
  QualityUsersPage,
  SourceGovernancePage,
  SupplierCreatePage,
  SupplierDetailPage,
  SuppliersPage,
} from './pages/AdminPages';
import { AccountPage, ChangePasswordPage, LoginPage } from './pages/AuthPages';
import {
  AuditPage,
  ExternalHealthPage,
  HenkatenDetailPage,
  HenkatenExplorerPage,
  NotificationsPage,
  OverviewPage,
  SystemStatusPage,
  WarningDetailPage,
  WarningsPage,
} from './pages/MonitoringPages';
import { AppLoading, ForbiddenPage, NotFoundPage, RouteErrorPage } from './pages/StatePages';
import { AssignmentBoardPage, HostedSupportPage, ShiftDetailPage } from './pages/SupportPages';

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
        <TmminSessionProvider>
          <ProductRoutes />
        </TmminSessionProvider>
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
            <TmminLayout />
          </AuthenticatedRoute>
        }
      >
        <Route
          index
          element={
            <CapabilityRoute capability="TMMIN_DASHBOARD_READ">
              <OverviewPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="warnings"
          element={
            <CapabilityRoute capability="TMMIN_HENKATEN_READ">
              <WarningsPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="warnings/:supplierId/:partNumber"
          element={
            <CapabilityRoute capability="TMMIN_HENKATEN_READ">
              <WarningDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens"
          element={
            <CapabilityRoute capability="TMMIN_HENKATEN_READ">
              <HenkatenExplorerPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="henkatens/:kind/:supplierId/:recordId"
          element={
            <CapabilityRoute capability="TMMIN_HENKATEN_READ">
              <HenkatenDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="suppliers"
          element={
            <CapabilityRoute capability="TMMIN_SUPPLIER_READ">
              <SuppliersPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="suppliers/new"
          element={
            <CapabilityRoute capability="TMMIN_SUPPLIER_MANAGE">
              <SupplierCreatePage />
            </CapabilityRoute>
          }
        />
        <Route
          path="suppliers/:supplierId"
          element={
            <CapabilityRoute capability="TMMIN_SUPPLIER_READ">
              <SupplierDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="suppliers/:supplierId/credentials"
          element={
            <CapabilityRoute capability="TMMIN_EXTERNAL_CLIENT_MANAGE">
              <ExternalCredentialsPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="source-governance"
          element={
            <CapabilityRoute capability="TMMIN_SUPPLIER_READ">
              <SourceGovernancePage />
            </CapabilityRoute>
          }
        />
        <Route
          path="external-health"
          element={
            <CapabilityRoute capability="TMMIN_HENKATEN_READ">
              <ExternalHealthPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="hosted-support"
          element={
            <CapabilityRoute capability="TMMIN_MASTER_DATA_READ">
              <HostedSupportPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="hosted-support/:supplierId/board"
          element={
            <CapabilityRoute capability="TMMIN_SHIFT_READ">
              <AssignmentBoardPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="hosted-support/:supplierId/shifts/:shiftId"
          element={
            <CapabilityRoute capability="TMMIN_SHIFT_READ">
              <ShiftDetailPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="quality-users"
          element={
            <CapabilityRoute capability="TMMIN_QUALITY_MANAGE">
              <QualityUsersPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <CapabilityRoute capability="TMMIN_DASHBOARD_READ">
              <NotificationsPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="audit"
          element={
            <CapabilityRoute capability="TMMIN_AUDIT_READ">
              <AuditPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="system-status"
          element={
            <CapabilityRoute capability="TMMIN_DASHBOARD_READ">
              <SystemStatusPage />
            </CapabilityRoute>
          }
        />
        <Route
          path="account"
          element={
            <CapabilityRoute capability="TMMIN_SUPPLIER_READ">
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

function AuthenticatedRoute({
  children,
  allowForced = false,
}: {
  children: ReactNode;
  allowForced?: boolean;
}) {
  const { status, session } = useTmminSession();
  const location = useLocation();
  if (status === 'loading') return <AppLoading />;
  if (!session) {
    rememberIntendedPath(`${location.pathname}${location.search}`);
    return <Navigate to="/login" replace />;
  }
  if (session.principal.mustChangePassword && !allowForced)
    return <Navigate to="/change-password" replace />;
  return children;
}

function AnonymousRoute({ children }: { children: ReactNode }) {
  const { status, session } = useTmminSession();
  if (status === 'loading') return <AppLoading />;
  if (session)
    return (
      <Navigate to={session.principal.mustChangePassword ? '/change-password' : '/'} replace />
    );
  return children;
}

function CapabilityRoute({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { session, hasCapability } = useTmminSession();
  if (!session || !hasCapability(capability)) return <ForbiddenPage />;
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
