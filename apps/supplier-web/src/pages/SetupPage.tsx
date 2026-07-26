import { ArrowRight, Check, CircleDashed, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Alert, Button, ErrorState, LastUpdated, Panel, Skeleton } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { ContextRail, SummaryMetric, SummaryStrip } from '../components/OperationalUI';

const areaMeta = {
  SHIFT_TEMPLATES: { label: 'Shift Template', to: '/master-data/shifts' },
  MEMBERS_ACCOUNTS: { label: 'Member & akun', to: '/master-data/members' },
  LINES_JOBS: { label: 'Line & job', to: '/master-data/lines' },
  PARTS: { label: 'Part', to: '/master-data/parts' },
  CHECKLISTS: { label: 'Checklist 4M', to: '/master-data/checklists' },
  DEFAULT_ASSIGNMENTS: {
    label: 'Default Assignment',
    to: '/master-data/default-assignments',
  },
} as const;

export function SetupPage() {
  const { session } = useSession();
  const identity = session!.principal;
  const supplier = session!.supplier!;
  const readiness = useQuery({
    queryKey: scopedKey(
      { userId: identity.userId, supplierId: supplier.id, purpose: identity.purpose },
      'setup-readiness',
    ),
    queryFn: () => supplierApi.setupReadiness(),
  });

  return (
    <div className="product-page">
      <PageHeader
        eyebrow={
          identity.purpose === 'HOSTED_PREPARATION' ? 'Hosted Preparation' : 'Konfigurasi tenant'
        }
        title="Setup Supplier"
        description="Selesaikan setiap prerequisite secara berurutan sampai operasi Hosted siap."
        actions={
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw />}
            onClick={() => void readiness.refetch()}
          >
            Perbarui readiness
          </Button>
        }
      />
      {identity.purpose === 'HOSTED_PREPARATION' && (
        <Alert tone="warning" title="Mode persiapan aktif">
          Route operasional ditolak server sampai source governance menyelesaikan cutover.
        </Alert>
      )}
      {readiness.isLoading && (
        <div className="setup-grid" aria-label="Memuat readiness">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} />
          ))}
        </div>
      )}
      {readiness.isError && (
        <ErrorState
          title="Readiness tidak dapat dimuat"
          description="Status tidak ditebak dari data browser. Coba ambil evaluasi server kembali."
          action={<Button onClick={() => void readiness.refetch()}>Coba lagi</Button>}
        />
      )}
      {readiness.data && (
        <>
          <SummaryStrip label="Ringkasan kesiapan Supplier" className="setup-summary-strip">
            <SummaryMetric
              label="Area selesai"
              value={readiness.data.areas.filter((area) => area.ready).length}
              detail={`dari ${readiness.data.areas.length} area`}
              icon={<Check />}
              tone={readiness.data.ready ? 'success' : 'info'}
            />
            <SummaryMetric
              label="Blocker aktif"
              value={readiness.data.blockers.length}
              detail={readiness.data.ready ? 'Tidak ada tindakan' : 'Perlu diselesaikan'}
              icon={<CircleDashed />}
              tone={readiness.data.blockers.length ? 'warning' : 'success'}
            />
            <SummaryMetric
              label="Langkah berikutnya"
              value={
                readiness.data.nextArea ? areaMeta[readiness.data.nextArea].label : 'Operasi Hosted'
              }
              detail={
                <LastUpdated
                  value={new Intl.DateTimeFormat('id-ID', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: supplier.timezone,
                  }).format(new Date(readiness.data.generatedAt))}
                />
              }
              tone={readiness.data.ready ? 'success' : 'neutral'}
            />
          </SummaryStrip>
          <div className="setup-workspace">
            <section className="setup-grid">
              {readiness.data.areas.map((area, index) => {
                const meta = areaMeta[area.area];
                return (
                  <Panel
                    key={area.area}
                    title={`${index + 1}. ${meta.label}`}
                    description={
                      area.ready
                        ? `${area.activeCount} data aktif · lengkap`
                        : `${area.activeCount}/${area.requiredCount} minimum · ${area.blockerCount} blocker`
                    }
                    className={area.ready ? 'setup-card is-ready' : 'setup-card'}
                  >
                    <div className="setup-card__state">
                      {area.ready ? <Check /> : <CircleDashed />}
                      <span>{area.ready ? 'Selesai' : 'Perlu tindakan'}</span>
                    </div>
                    <Link to={meta.to}>
                      {area.ready ? 'Tinjau konfigurasi' : 'Lengkapi sekarang'}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Panel>
                );
              })}
            </section>
            <ContextRail
              eyebrow="Readiness authoritative"
              title={
                readiness.data.nextArea
                  ? areaMeta[readiness.data.nextArea].label
                  : 'Semua area siap'
              }
              footer={
                readiness.data.nextArea ? (
                  <Link to={areaMeta[readiness.data.nextArea].to}>
                    Buka area berikutnya <ArrowRight aria-hidden="true" />
                  </Link>
                ) : undefined
              }
            >
              {readiness.data.ready ? (
                <Alert tone="success" title="Siap beroperasi">
                  Semua prerequisite Hosted telah dipenuhi.
                </Alert>
              ) : (
                <>
                  <p className="setup-next-copy">
                    Selesaikan bukti blocker berikut sebelum melanjutkan ke area berikutnya.
                  </p>
                  <ul className="blocker-list">
                    {readiness.data.blockers.map((blocker, index) => (
                      <li key={`${blocker.code}-${index}`}>
                        <span>{areaMeta[blocker.area].label}</span>
                        <strong>{blocker.detail}</strong>
                        <code>{blocker.code}</code>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </ContextRail>
          </div>
        </>
      )}
    </div>
  );
}
