import { Ban, FileQuestion, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button, Card, Spinner } from '@tmmin-henkaten/ui';

export function AppLoading() {
  return (
    <main className="tmmin-route-state" aria-busy="true">
      <Spinner label="Memuat TMMIN Portal" />
    </main>
  );
}

export function ForbiddenPage() {
  return (
    <div className="tmmin-route-state">
      <Card>
        <Ban aria-hidden="true" />
        <span className="tmmin-eyebrow">403 · Akses ditolak</span>
        <h1>Halaman ini tidak tersedia untuk role Anda.</h1>
        <p>Monitoring Quality bersifat hanya baca dan kontrol administrasi tidak ditampilkan.</p>
        <Link className="hds-button hds-button--primary hds-button--md" to="/">
          Kembali ke overview
        </Link>
      </Card>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="tmmin-route-state">
      <Card>
        <FileQuestion aria-hidden="true" />
        <span className="tmmin-eyebrow">404 · Tidak ditemukan</span>
        <h1>Halaman atau resource tidak tersedia.</h1>
        <p>Periksa supplier dan source epoch pada filter, lalu coba kembali.</p>
        <Link className="hds-button hds-button--primary hds-button--md" to="/">
          Kembali ke overview
        </Link>
      </Card>
    </div>
  );
}

export function RouteErrorPage() {
  return (
    <div className="tmmin-route-state">
      <Card>
        <RefreshCw aria-hidden="true" />
        <span className="tmmin-eyebrow">Aplikasi perlu dimuat ulang</span>
        <h1>State halaman tidak dapat dipulihkan.</h1>
        <p>Credential satu kali dan input sensitif tidak disimpan.</p>
        <Button onClick={() => window.location.reload()}>Muat ulang</Button>
      </Card>
    </div>
  );
}

export function QueryState({
  error,
  retry,
  empty,
}: {
  error?: unknown;
  retry?: () => void;
  empty?: string;
}) {
  if (error) {
    const correlation =
      typeof error === 'object' && error && 'problem' in error
        ? String((error as { problem?: { correlationId?: string } }).problem?.correlationId ?? '')
        : '';
    return (
      <Card className="tmmin-query-state" role="alert">
        <h2>Data belum dapat dimuat</h2>
        <p>
          Coba lagi.{' '}
          {correlation && (
            <>
              Correlation ID: <code>{correlation}</code>
            </>
          )}
        </p>
        {retry && <Button onClick={retry}>Coba lagi</Button>}
      </Card>
    );
  }
  return (
    <Card className="tmmin-query-state">
      <h2>Belum ada data</h2>
      <p>{empty ?? 'Tidak ada record yang cocok dengan filter saat ini.'}</p>
    </Card>
  );
}
