import { BellRing, CheckCircle2, Download, ShieldAlert, Smartphone } from 'lucide-react';

import { Alert, Button, Card } from '@tmmin-henkaten/ui';

import { usePush } from '../app/push';

export function PushSettings({ required = false }: { required?: boolean }) {
  const { config, support, permission, busy, error, enable, disable, refresh } = usePush();
  const active = config?.subscription?.status === 'ACTIVE' && permission === 'granted';
  return (
    <Card className="push-settings">
      <div className="push-settings__heading">
        <span aria-hidden="true">{active ? <CheckCircle2 /> : <BellRing />}</span>
        <div>
          <strong>{active ? 'Push aktif pada perangkat ini' : 'Aktifkan push notification'}</strong>
          <p>
            {required
              ? 'Line Leader wajib mengaktifkan push sebelum membuka workflow operasional.'
              : 'Push bersifat opt-in dan mempercepat perhatian; notification center tetap sumber kebenaran.'}
          </p>
        </div>
      </div>
      {support === 'IOS_INSTALL_REQUIRED' && (
        <Alert tone="warning" title="Pasang ke Home Screen terlebih dahulu">
          <Download aria-hidden="true" /> Buka menu Share, pilih Add to Home Screen, lalu jalankan
          Henkaten dari ikon Home Screen.
        </Alert>
      )}
      {support === 'UNSUPPORTED' && (
        <Alert tone="danger" title="Browser tidak mendukung Web Push">
          <Smartphone aria-hidden="true" /> Gunakan Chrome/Edge yang didukung atau Home Screen PWA
          pada iOS/iPadOS 16.4 ke atas.
        </Alert>
      )}
      {permission === 'denied' && (
        <Alert tone="danger" title="Izin browser ditolak">
          <ShieldAlert aria-hidden="true" /> Buka pengaturan site notification pada browser dan ubah
          izin menjadi Allow.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" title="Push belum siap">
          {error}
        </Alert>
      )}
      <dl className="push-settings__facts">
        <div>
          <dt>Requirement</dt>
          <dd>{required ? 'Wajib' : 'Opsional'}</dd>
        </div>
        <div>
          <dt>Permission</dt>
          <dd>{permission}</dd>
        </div>
        <div>
          <dt>Server</dt>
          <dd>{config?.enabled ? 'Aktif' : 'Tidak aktif'}</dd>
        </div>
        <div>
          <dt>Subscription</dt>
          <dd>{active ? 'Terhubung' : 'Belum terhubung'}</dd>
        </div>
      </dl>
      <div className="form-actions">
        {active ? (
          <Button variant="secondary" loading={busy} onClick={() => void disable()}>
            Nonaktifkan pada perangkat ini
          </Button>
        ) : (
          <Button
            loading={busy}
            disabled={support !== 'SUPPORTED' || permission === 'denied' || !config?.enabled}
            onClick={() => void enable()}
          >
            Aktifkan push
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
          Periksa ulang
        </Button>
      </div>
    </Card>
  );
}

export function PushRequiredPage() {
  return (
    <section className="push-required" aria-labelledby="push-required-title">
      <div>
        <span className="product-eyebrow">Persyaratan Line Leader</span>
        <h1 id="push-required-title" tabIndex={-1}>
          Aktifkan push untuk melanjutkan
        </h1>
        <p>
          Perangkat ini belum terhubung ke Web Push. Workflow operasional akan terbuka segera
          setelah subscription aktif.
        </p>
      </div>
      <PushSettings required />
    </section>
  );
}
