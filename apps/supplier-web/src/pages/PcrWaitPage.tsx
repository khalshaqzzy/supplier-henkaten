import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, LoaderCircle } from 'lucide-react';

import { Button } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';

export function PcrWaitPage() {
  const { henkatenId = '' } = useParams();
  const navigate = useNavigate();
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
  useEffect(() => {
    if (record.data && status !== 'PENDING') {
      void navigate(`/henkatens/${henkatenId}`, { replace: true });
    }
  }, [record.data, status, henkatenId, navigate]);
  return (
    <div className="pcr-wait-page" aria-live="polite">
      <div className="pcr-wait-page__surface">
        <div className="pcr-wait-page__step">
          <CircleCheck aria-hidden="true" />
          <span>Henkaten berhasil diajukan</span>
        </div>
        <div className="pcr-wait-page__indicator" aria-hidden="true">
          <LoaderCircle />
        </div>
        <h1>Menilai kebutuhan PCR</h1>
        <p>
          Mohon tunggu sementara perubahan proses ditinjau. Hasilnya akan muncul pada detail
          Henkaten.
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
    </div>
  );
}
