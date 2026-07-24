import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const DesignSystemShowcase = lazy(() =>
  import('@tmmin-henkaten/ui').then((module) => ({
    default: module.DesignSystemShowcase,
  })),
);

function DesignLoadingState() {
  return (
    <main className="design-loading" aria-busy="true">
      <span aria-hidden="true" />
      <p role="status">Memuat Henkaten Design System…</p>
    </main>
  );
}

function FoundationPlaceholder() {
  return (
    <main className="foundation-placeholder">
      <div>
        <span>Supplier Web · Phase 11 foundation</span>
        <h1>Production workflow belum diaktifkan.</h1>
        <p>
          Workspace, routing, dan shared design system sudah tersedia. Session bootstrap dan fitur
          Supplier akan diimplementasikan pada subphase berikutnya.
        </p>
        <a href="/design">Buka Henkaten Design System</a>
      </div>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/design"
        element={
          <Suspense fallback={<DesignLoadingState />}>
            <DesignSystemShowcase />
          </Suspense>
        }
      />
      <Route path="/" element={<FoundationPlaceholder />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
