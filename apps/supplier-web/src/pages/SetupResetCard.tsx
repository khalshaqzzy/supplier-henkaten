import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import { Alert, Button, Dialog, Field, PasswordInput, Skeleton, toast } from '@tmmin-henkaten/ui';
import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import { scopedKey } from '../app/query';
import { setupErrorMessage, setupResultUncertain } from './SetupImportDialog';
import './setup-import.css';

export function SetupResetCard() {
  const { session } = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const retry = useRef<{ body: { revision: number; password: string }; key: string } | null>(null);
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const summary = useQuery({
    queryKey: scopedKey(scope, 'setup-reset-preview'),
    queryFn: () => supplierApi.setupResetPreview(),
    enabled: open,
    staleTime: 0,
  });
  useEffect(() => {
    if (!retryAt) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  useEffect(
    () => () => {
      retry.current = null;
    },
    [],
  );
  const changeOpen = (next: boolean) => {
    if (busy || uncertain) return;
    setOpen(next);
    setPassword('');
    setProblem(null);
    setPasswordError(null);
    retry.current = null;
  };
  const reset = async () => {
    if (!retry.current) {
      if (!summary.data) return;
      retry.current = {
        body: { revision: summary.data.revision, password },
        key: createIdempotencyKey(),
      };
    }
    setBusy(true);
    setProblem(null);
    setPasswordError(null);
    try {
      await supplierApi.resetSetup(retry.current.body, retry.current.key);
      retry.current = null;
      setPassword('');
      setUncertain(false);
      setOpen(false);
      await client.invalidateQueries();
      toast.success('Setup direset');
      void navigate('/setup');
    } catch (error) {
      const unknown = setupResultUncertain(error);
      setUncertain(unknown);
      if (unknown)
        setProblem('Hasil reset belum pasti. Periksa hasil sebelum mencoba perubahan lain.');
      else {
        retry.current = null;
        if (
          error instanceof ApiProblemError &&
          error.problem.fieldErrors?.some((e) => e.path === 'password')
        )
          setPasswordError(error.problem.detail);
        else setProblem(setupErrorMessage(error));
        if (error instanceof ApiProblemError && error.problem.status === 409) {
          setPassword('');
          void summary.refetch();
        }
        if (error instanceof ApiProblemError && error.problem.status === 429)
          setRetryAt(Date.now() + (error.retryAfterSeconds ?? 900) * 1000);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="setup-reset-card">
      <div className="setup-reset-card__icon">
        <RotateCcw />
      </div>
      <div>
        <h2>Reset setup</h2>
        <p>Kosongkan master data dan assignment. Riwayat Henkaten tetap tersimpan.</p>
      </div>
      <Dialog
        open={open}
        onOpenChange={changeOpen}
        title="Reset setup supplier?"
        description="Akun member akan dinonaktifkan. Akun admin dan riwayat Henkaten tetap tersimpan."
        size="md"
        className="setup-reset-dialog"
        trigger={
          <Button variant="danger" leadingIcon={<RotateCcw />}>
            Reset setup
          </Button>
        }
        footer={
          <div className="setup-reset-footer">
            <span role="status" aria-live="polite">
              {busy ? (
                <>
                  <LoaderCircle className="hds-spinner" />
                  {uncertain ? 'Memeriksa hasil reset…' : 'Memverifikasi dan mereset…'}
                </>
              ) : seconds > 0 ? (
                `Coba lagi dalam ${seconds} detik`
              ) : (
                'Verifikasi dengan password admin'
              )}
            </span>
            <div>
              <Button onClick={() => changeOpen(false)} disabled={busy || uncertain}>
                Batal
              </Button>
              <Button
                variant="danger"
                loading={busy}
                disabled={
                  !uncertain &&
                  (!summary.data ||
                    summary.isFetching ||
                    summary.data.empty ||
                    summary.data.openCount > 0 ||
                    !password ||
                    seconds > 0)
                }
                onClick={() => void reset()}
              >
                {uncertain ? 'Periksa hasil reset' : 'Reset setup'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="setup-reset-content" aria-busy={busy || summary.isFetching}>
          <div className="setup-reset-supplier">
            <span>Supplier</span>
            <strong>{session!.supplier!.name}</strong>
          </div>
          {summary.isLoading ? (
            <div className="setup-reset-counts" aria-label="Memuat ringkasan reset">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} />
              ))}
            </div>
          ) : summary.isError ? (
            <Alert tone="danger" title="Ringkasan tidak dapat dimuat">
              <Button size="sm" onClick={() => void summary.refetch()} loading={summary.isFetching}>
                Coba lagi
              </Button>
            </Alert>
          ) : (
            summary.data && (
              <>
                <div className="setup-reset-counts">
                  {summary.data.counts.map((c) => (
                    <div key={c.label}>
                      <span>{c.label}</span>
                      <strong>{c.count.toLocaleString('id-ID')}</strong>
                    </div>
                  ))}
                </div>
                {summary.data.openCount > 0 ? (
                  <Alert tone="warning" title={`${summary.data.openCount} Henkaten masih Open`}>
                    <Link to="/henkatens?status=OPEN" onClick={() => setOpen(false)}>
                      Lihat Henkaten Open
                    </Link>
                  </Alert>
                ) : summary.data.empty ? (
                  <Alert title="Setup sudah kosong" tone="info" />
                ) : (
                  <Field
                    label="Password admin"
                    htmlFor="setup-reset-password"
                    errorText={passwordError ?? undefined}
                  >
                    <PasswordInput
                      id="setup-reset-password"
                      value={password}
                      autoComplete="current-password"
                      disabled={busy || uncertain || seconds > 0}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setPasswordError(null);
                      }}
                    />
                  </Field>
                )}
              </>
            )
          )}
          {problem && (
            <Alert
              tone="danger"
              title={uncertain ? 'Memeriksa hasil reset' : 'Reset belum selesai'}
            >
              {problem}
            </Alert>
          )}
        </div>
      </Dialog>
    </section>
  );
}
