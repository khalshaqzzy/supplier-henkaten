import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, ShieldAlert, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import type {
  DeleteHenkatenRequest,
  DeleteSupplierHenkatensRequest,
} from '@tmmin-henkaten/contracts';
import { Alert, Button, Dialog, Field, Input, Textarea } from '@tmmin-henkaten/ui';
import { tmminApi } from '../app/api';
import { tmminKey } from '../app/query';
import { useTmminSession } from '../app/session';

type Target = { kind: 'HOSTED' | 'EXTERNAL'; id: string; label: string; version: number };
type Intent = { key: string; body: DeleteHenkatenRequest | DeleteSupplierHenkatensRequest };

export function HenkatenDeletion({
  supplierId,
  supplierLabel,
  target,
  onDeleted,
  onStale,
}: {
  supplierId: string;
  supplierLabel?: string;
  target?: Target;
  onDeleted?: () => void;
  onStale?: () => void;
}) {
  const { session, hasCapability } = useTmminSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const intent = useRef<Intent | null>(null);
  const allowed = hasCapability('TMMIN_HENKATEN_DELETE');
  const preview = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'henkaten-deletion-preview', supplierId),
    queryFn: () => tmminApi.henkatenDeletionPreview(supplierId),
    enabled: allowed && open && !target,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (request: Intent) =>
      target
        ? tmminApi.deleteHenkaten(
            target.kind,
            supplierId,
            target.id,
            request.body as DeleteHenkatenRequest,
            request.key,
          )
        : tmminApi.deleteSupplierHenkatens(
            supplierId,
            request.body as DeleteSupplierHenkatensRequest,
            request.key,
          ),
    onSuccess: async (result) => {
      intent.current = null;
      setUncertain(false);
      setOpen(false);
      setReason('');
      setCode('');
      setProblem(null);
      setSuccess(
        target ? 'Henkaten dihapus.' : `${result.total.toLocaleString('id-ID')} Henkaten dihapus.`,
      );
      queryClient.removeQueries({
        queryKey: tmminKey(session!.principal.userId, 'henkaten-detail'),
        exact: false,
      });
      await queryClient.invalidateQueries({ queryKey: ['TMMIN', session!.principal.userId] });
      onDeleted?.();
    },
    onError: (error) => {
      const definite = error instanceof ApiProblemError && error.problem.status < 500;
      setUncertain(!definite);
      if (definite) {
        intent.current = null;
        setProblem(error.problem.detail);
        if (error.problem.status === 409) {
          if (!target) void preview.refetch();
          onStale?.();
        }
      } else
        setProblem(
          'Hasil penghapusan belum dapat dipastikan. Coba lagi untuk memeriksa permintaan ini.',
        );
    },
  });
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);
  if (!allowed) return null;
  const locked = mutation.isPending || uncertain;
  const ready =
    reason.trim().length > 0 &&
    (target ||
      (preview.data &&
        !preview.isFetching &&
        preview.data.total > 0 &&
        code.trim() === preview.data.supplierCode));
  const label = target ? 'Hapus Henkaten' : 'Hapus semua Henkaten';
  const submit = () => {
    if (!intent.current)
      intent.current = {
        key: createIdempotencyKey(),
        body: target
          ? { expectedVersion: target.version, reason: reason.trim() }
          : {
              expectedRevision: preview.data!.revision,
              supplierCode: code.trim(),
              reason: reason.trim(),
            },
      };
    setProblem(null);
    mutation.mutate(intent.current);
  };
  return (
    <div className={target ? 'henkaten-delete-action' : 'henkaten-delete-panel'}>
      {!target && (
        <div className="henkaten-delete-panel__copy">
          <span className="henkaten-delete-panel__icon">
            <Trash2 aria-hidden="true" size={18} />
          </span>
          <div>
            <h2>Data Henkaten</h2>
            <p>Hapus seluruh Henkaten supplier ini.</p>
          </div>
        </div>
      )}
      {success && (
        <p className="henkaten-delete-success" role="status">
          {success}
        </p>
      )}
      <Button
        variant="secondary"
        className="henkaten-delete-trigger"
        leadingIcon={<Trash2 size={16} aria-hidden="true" />}
        onClick={() => {
          if (!uncertain) {
            intent.current = null;
            setProblem(null);
            setReason('');
            setCode('');
          }
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next);
        }}
        size="sm"
        dismissible={!mutation.isPending}
        className="henkaten-delete-dialog"
        title={`${label}?`}
        description="Data yang dihapus tidak dapat ditampilkan atau dipulihkan melalui aplikasi."
        headerAdornment={<ShieldAlert size={22} aria-hidden="true" />}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              loading={mutation.isPending}
              disabled={!uncertain && !ready}
              onClick={submit}
            >
              {mutation.isPending
                ? 'Menghapus…'
                : uncertain
                  ? 'Coba lagi'
                  : target
                    ? label
                    : 'Hapus semua'}
            </Button>
          </>
        }
      >
        <div className="henkaten-delete-target">
          <span>{target ? 'HENKATEN' : 'SUPPLIER'}</span>
          <strong>{target?.label ?? supplierLabel}</strong>
          {target && <span>{target.kind === 'HOSTED' ? 'Hosted' : 'External'}</span>}
        </div>
        {!target && (
          <div
            className="henkaten-delete-preview"
            aria-live="polite"
            aria-busy={preview.isFetching}
          >
            {preview.isPending ? (
              <p>Memuat ringkasan…</p>
            ) : preview.isError ? (
              <>
                <p>Ringkasan belum dapat dimuat.</p>
                <Button variant="ghost" onClick={() => void preview.refetch()}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Coba lagi
                </Button>
              </>
            ) : (
              preview.data && (
                <>
                  <div>
                    <strong>{preview.data.total.toLocaleString('id-ID')}</strong>
                    <span>Henkaten akan dihapus</span>
                  </div>
                  <p>
                    <span>
                      Hosted <b>{preview.data.hosted.toLocaleString('id-ID')}</b>
                    </span>
                    <span>
                      External <b>{preview.data.external.toLocaleString('id-ID')}</b>
                    </span>
                  </p>
                  {preview.data.total === 0 && <p>Tidak ada Henkaten untuk dihapus.</p>}
                </>
              )
            )}
          </div>
        )}
        {!target && preview.data && (
          <Field
            label={`Ketik ${preview.data.supplierCode} untuk mengonfirmasi`}
            htmlFor="henkaten-delete-code"
          >
            <Input
              id="henkaten-delete-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={locked}
            />
          </Field>
        )}
        <Field label="Alasan penghapusan" htmlFor="henkaten-delete-reason">
          <Textarea
            id="henkaten-delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            required
            disabled={locked}
          />
        </Field>
        {problem && (
          <Alert
            tone="danger"
            title={uncertain ? 'Periksa hasil penghapusan' : 'Penghapusan belum dilakukan'}
          >
            {problem}
          </Alert>
        )}
      </Dialog>
    </div>
  );
}
