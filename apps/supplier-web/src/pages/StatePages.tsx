import { Ban, FileQuestion, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button, Card, Spinner } from '@tmmin-henkaten/ui';

export function AppLoading() {
  return (
    <main className="route-state" aria-busy="true">
      <Spinner label="Memuat session Supplier" />
    </main>
  );
}

export function ForbiddenPage() {
  return (
    <div className="route-state">
      <Card>
        <Ban aria-hidden="true" />
        <span className="product-eyebrow">403 · Akses ditolak</span>
        <h1>Anda tidak memiliki akses ke halaman ini.</h1>
        <p>Capability dan scope line diverifikasi kembali oleh server pada setiap permintaan.</p>
        <Link className="hds-button hds-button--primary hds-button--md" to="/">
          Kembali ke halaman utama
        </Link>
      </Card>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="route-state">
      <Card>
        <FileQuestion aria-hidden="true" />
        <span className="product-eyebrow">404 · Tidak ditemukan</span>
        <h1>Halaman atau resource tidak tersedia.</h1>
        <p>Alamat mungkin berubah, resource telah dinonaktifkan, atau berada di luar scope Anda.</p>
        <Link className="hds-button hds-button--primary hds-button--md" to="/">
          Kembali ke halaman utama
        </Link>
      </Card>
    </div>
  );
}

export function RouteErrorPage() {
  return (
    <div className="route-state">
      <Card>
        <RefreshCw aria-hidden="true" />
        <span className="product-eyebrow">Aplikasi perlu dimuat ulang</span>
        <h1>Halaman mengalami masalah yang tidak terduga.</h1>
        <p>
          Input sensitif tidak disimpan. Muat ulang untuk mengambil state authoritative terbaru.
        </p>
        <Button onClick={() => window.location.reload()}>Muat ulang</Button>
      </Card>
    </div>
  );
}
