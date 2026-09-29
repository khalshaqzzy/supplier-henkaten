import { useCallback, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, FileCheck2, LoaderCircle } from 'lucide-react';

import { Button, Dialog } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';

export function PcrWaitPage() {
  const { henkatenId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useSession();
  const record = useQuery({
    queryKey: scopedKey(
      {
        userId: session!.principal.userId,
        supplierId: session!.supplier!.id,
        purpose: session!.principal.purpose,
      },
      'pcr-assessment',
      henkatenId,
    ),
    queryFn: () => supplierApi.henkaten(henkatenId),
    refetchInterval: (query) => (query.state.data?.pcr?.status === 'PENDING' ? 1500 : false),
    retry: 2,
  });
  const status = record.data?.pcr?.status;
  const assessment = record.data?.pcr?.assessment?.trim();
  const assessmentLabel =
    record.data?.pcr?.decisionSource === 'AI' ? 'Hasil assessment AI' : 'Hasil penilaian PCR';
  const submittedHere =
    (location.state as { submittedHenkatenId?: string } | null)?.submittedHenkatenId === henkatenId;
  const showPcrDialog =
    submittedHere && session?.principal.role === 'LINE_LEADER' && status === 'PCR';
  const openDetail = useCallback(
    () => void navigate(`/henkatens/${henkatenId}`, { replace: true, state: null }),
    [navigate, henkatenId],
  );
  useEffect(() => {
    if (record.data && status !== 'PENDING' && !showPcrDialog) {
      openDetail();
    }
  }, [record.data, status, showPcrDialog, openDetail]);
  return (
    <div className="pcr-wait-page" aria-live="polite">
      {!showPcrDialog && (
        <div className="pcr-wait-page__surface">
          <div className="pcr-wait-page__step">
            <CircleCheck aria-hidden="true" />
            <span>Henkaten berhasil diajukan</span>
          </div>
          {status !== 'PCR' && (
            <div className="pcr-wait-page__indicator" aria-hidden="true">
              <LoaderCircle />
            </div>
          )}
          <h1>{status === 'PCR' ? 'PCR diperlukan' : 'Menilai kebutuhan PCR'}</h1>
          <p>
            {status === 'PCR'
              ? 'Ajukan PCR melalui jalur yang berlaku.'
              : 'Hasil penilaian akan tampil di detail Henkaten.'}
          </p>
          <strong>{record.data?.identifier ?? ''}</strong>
          {record.isError && (
            <div className="pcr-wait-page__recovery">
              <p>Hasil belum dapat dimuat. Henkaten Anda sudah tersimpan.</p>
              <Button variant="secondary" onClick={() => void record.refetch()}>
                Coba lagi
              </Button>
              <Link to={`/henkatens/${henkatenId}`}>
                Buka detail <ArrowRight />
              </Link>
            </div>
          )}
        </div>
      )}
      <Dialog
        title="PCR diperlukan"
        description="Ajukan PCR melalui jalur yang berlaku."
        eyebrow="Penilaian selesai"
        headerAdornment={<FileCheck2 aria-hidden="true" />}
        className="pcr-guidance-dialog"
        open={showPcrDialog}
        onOpenChange={(open) => {
          if (!open) openDetail();
        }}
        footer={
          <Button variant="primary" onClick={openDetail}>
            Lihat Henkaten
          </Button>
        }
      >
        {assessment && (
          <section className="pcr-guidance-dialog__assessment" aria-label={assessmentLabel}>
            <span>{assessmentLabel}</span>
            <p>{assessment}</p>
          </section>
        )}
        <p className="pcr-guidance-dialog__contact">
          Jika ada kendala atau hasil penilaian tidak sesuai, hubungi TMMIN QD.
        </p>
      </Dialog>
    </div>
  );
}
