import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import { BrandLockup, Button, Card, Field, Input, KeyValueGrid, Spinner } from '@tmmin-henkaten/ui';

import { TmminSessionProvider, useTmminSession } from './app/session';

const DesignSystemShowcase = lazy(() =>
  import('@tmmin-henkaten/ui/showcase').then((module) => ({
    default: module.DesignSystemShowcase,
  })),
);

export function App() {
  if (window.location.pathname === '/design') return <DesignRoute />;
  return (
    <TmminSessionProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <Anonymous>
              <Login />
            </Anonymous>
          }
        />
        <Route
          path="/change-password"
          element={
            <Authenticated allowForced>
              <ChangePassword />
            </Authenticated>
          }
        />
        <Route
          path="/"
          element={
            <Authenticated>
              <Foundation />
            </Authenticated>
          }
        />
        <Route
          path="/account"
          element={
            <Authenticated>
              <Account />
            </Authenticated>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TmminSessionProvider>
  );
}

function Login() {
  const { login } = useTmminSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem('');
    try {
      const session = await login({ username, password });
      void navigate(session.principal.mustChangePassword ? '/change-password' : '/', {
        replace: true,
      });
    } catch (error) {
      setProblem(
        error instanceof ApiProblemError && error.problem.status === 429
          ? `Terlalu banyak percobaan. Coba kembali dalam ${error.retryAfterSeconds ?? 60} detik.`
          : 'Username atau password tidak valid.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="tmmin-auth">
      <section>
        <BrandLockup context="TMMIN Portal" />
        <div>
          <span>Enterprise Digital Henkaten</span>
          <h1>Governance lintas supplier yang dapat ditelusuri.</h1>
          <p>Administration dan quality workflow tersedia pada Phase 13.</p>
        </div>
      </section>
      <Card>
        <h2>Masuk ke TMMIN Portal</h2>
        <p>Gunakan identitas internal TMMIN.</p>
        {problem && (
          <div className="tmmin-error" role="alert">
            {problem}
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          <Field label="Username" htmlFor="username" required>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy}>
            Masuk
          </Button>
        </form>
      </Card>
    </main>
  );
}

function ChangePassword() {
  const { session, changePassword, logout } = useTmminSession();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) return setProblem('Konfirmasi password tidak sama.');
    try {
      await changePassword({ currentPassword, newPassword });
    } catch {
      setProblem('Password tidak dapat diubah.');
    }
  };
  return (
    <main className="tmmin-compact">
      <Card>
        <BrandLockup context="TMMIN Portal" />
        <h1>
          {session?.principal.mustChangePassword ? 'Ganti temporary password' : 'Ganti password'}
        </h1>
        {problem && <div className="tmmin-error">{problem}</div>}
        <form onSubmit={(event) => void submit(event)}>
          <Field label="Password sekarang">
            <Input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
          <Field label="Password baru">
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
          <Field label="Konfirmasi">
            <Input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          <Button type="submit">Simpan dan masuk ulang</Button>
          <Button variant="ghost" onClick={() => void logout()}>
            Keluar
          </Button>
        </form>
      </Card>
    </main>
  );
}

function Foundation() {
  const { session, logout } = useTmminSession();
  return (
    <div className="tmmin-shell">
      <aside>
        <BrandLockup context="TMMIN Portal" />
        <nav>
          <a className="is-current" href="/">
            Foundation
          </a>
          <a href="/account">Akun</a>
        </nav>
        <Button variant="ghost" onClick={() => void logout()}>
          Keluar
        </Button>
      </aside>
      <main>
        <header>
          <span>TMMIN application foundation</span>
          <strong>{session!.principal.displayName}</strong>
        </header>
        <section>
          <span>Phase 11 selesai · Phase 13 berikutnya</span>
          <h1>Authenticated TMMIN shell siap.</h1>
          <p>
            Session realm, forced reset, account, logout, capability context, dan design utility
            tersedia. Workflow TMMIN sengaja tetap ditutup sampai Phase 13.
          </p>
          <Card>
            <h2>Capability session</h2>
            <div className="capability-list">
              {session!.capabilities.map((capability) => (
                <code key={capability}>{capability}</code>
              ))}
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}

function Account() {
  const { session, logout } = useTmminSession();
  const navigate = useNavigate();
  return (
    <div className="tmmin-compact">
      <Card>
        <BrandLockup context="TMMIN Portal" />
        <h1>Akun</h1>
        <KeyValueGrid
          items={[
            { label: 'Nama', value: session!.principal.displayName },
            { label: 'Role', value: session!.principal.role },
            {
              label: 'Idle expiry',
              value: new Date(session!.idleExpiresAt).toLocaleString('id-ID'),
            },
            {
              label: 'Absolute expiry',
              value: new Date(session!.absoluteExpiresAt).toLocaleString('id-ID'),
            },
          ]}
        />
        <Button onClick={() => void navigate('/change-password')}>Ganti password</Button>
        <Button variant="danger" onClick={() => void logout()}>
          Keluar
        </Button>
      </Card>
    </div>
  );
}

function Authenticated({
  children,
  allowForced = false,
}: {
  children: ReactNode;
  allowForced?: boolean;
}) {
  const { status, session } = useTmminSession();
  const location = useLocation();
  if (status === 'loading')
    return (
      <main className="tmmin-loading">
        <Spinner label="Memuat session TMMIN" />
      </main>
    );
  if (!session) {
    sessionStorage.setItem(
      'tmmin-henkaten:intended-path',
      `${location.pathname}${location.search}`,
    );
    return <Navigate to="/login" replace />;
  }
  if (session.principal.mustChangePassword && !allowForced)
    return <Navigate to="/change-password" replace />;
  return children;
}

function Anonymous({ children }: { children: ReactNode }) {
  const { status, session } = useTmminSession();
  if (status === 'loading')
    return (
      <main className="tmmin-loading">
        <Spinner label="Memuat session TMMIN" />
      </main>
    );
  if (session)
    return (
      <Navigate to={session.principal.mustChangePassword ? '/change-password' : '/'} replace />
    );
  return children;
}

function DesignRoute() {
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow';
    document.head.append(robots);
    return () => robots.remove();
  }, []);
  return (
    <Suspense
      fallback={
        <main className="design-loading">
          <span />
          <p>Memuat design system…</p>
        </main>
      }
    >
      <DesignSystemShowcase />
    </Suspense>
  );
}
