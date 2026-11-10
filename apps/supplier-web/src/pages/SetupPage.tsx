import { ArrowRight, Check, CircleCheckBig, CircleDashed, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { SupplierSetupReadiness } from '@tmmin-henkaten/contracts';
import { Alert, Button, ErrorState, LastUpdated, Skeleton } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { ContextRail, SummaryMetric, SummaryStrip } from '../components/OperationalUI';
import { SetupBlockerPanel, areaSectionId } from './SetupBlockerPanel';
import { groupSetupBlockers, setupAreaMeta, type BlockerAreaGroup } from './setupBlockers';
import './setup-blockers.css';

const OPEN_PARAM = 'open';

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
    // Returning from a corrective page must not show a blocker that was just resolved.
    refetchOnMount: 'always',
  });

  return (
    <div className="product-page">
      <PageHeader
        eyebrow={
          identity.purpose === 'HOSTED_PREPARATION' ? 'Persiapan Supplier' : 'Konfigurasi supplier'
        }
        title="Setup Supplier"
        description=""
        actions={
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw />}
            loading={readiness.isFetching && !readiness.isLoading}
            onClick={() => void readiness.refetch()}
          >
            Perbarui readiness
          </Button>
        }
      />
      {identity.purpose === 'HOSTED_PREPARATION' && (
        <Alert tone="warning" title="Mode persiapan aktif">
          Henkaten baru dapat diajukan setelah persiapan selesai.
        </Alert>
      )}
      {readiness.isLoading && (
        <div className="setup-workspace" aria-label="Memuat readiness">
          <Skeleton className="setup-skeleton is-main" />
          <Skeleton className="setup-skeleton is-rail" />
        </div>
      )}
      {readiness.isError && (
        <ErrorState
          title="Readiness tidak dapat dimuat"
          description=""
          action={<Button onClick={() => void readiness.refetch()}>Coba lagi</Button>}
        />
      )}
      {readiness.data && <SetupReadiness data={readiness.data} timezone={supplier.timezone} />}
    </div>
  );
}

function SetupReadiness({ data, timezone }: { data: SupplierSetupReadiness; timezone: string }) {
  const [params, setParams] = useSearchParams();
  const groups = useMemo(() => groupSetupBlockers(data.blockers), [data.blockers]);
  const issueKeys = groups.flatMap((group) => group.issues.map((issue) => issue.key));
  // Expanded issues live in the URL so returning with Back restores the same view.
  const openKeys = new Set(
    params.has(OPEN_PARAM)
      ? (params.get(OPEN_PARAM) ?? '').split(',').filter((key) => issueKeys.includes(key))
      : issueKeys.slice(0, 1),
  );
  const setOpenKeys = (keys: Set<string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(OPEN_PARAM, issueKeys.filter((key) => keys.has(key)).join(','));
        return next;
      },
      { replace: true },
    );
  const revealArea = (group: BlockerAreaGroup) => {
    setOpenKeys(new Set([...openKeys, ...group.issues.map((issue) => issue.key)]));
    const section = document.getElementById(areaSectionId(group.area));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    section?.focus({ preventScroll: true });
  };
  const nextArea = data.nextArea ? setupAreaMeta[data.nextArea] : null;

  return (
    <>
      <SummaryStrip label="Ringkasan kesiapan Supplier" className="setup-summary-strip">
        <SummaryMetric
          label="Area selesai"
          value={data.areas.filter((area) => area.ready).length}
          detail={`dari ${data.areas.length} area`}
          icon={<Check />}
          tone={data.ready ? 'success' : 'info'}
        />
        <SummaryMetric
          label="Blocker aktif"
          value={data.blockers.length}
          detail={data.ready ? 'Tidak ada tindakan' : 'Perlu diselesaikan'}
          icon={<CircleDashed />}
          tone={data.blockers.length ? 'warning' : 'success'}
        />
        <SummaryMetric
          label="Langkah berikutnya"
          value={nextArea ? nextArea.label : 'Operasional'}
          detail={
            <LastUpdated
              value={new Intl.DateTimeFormat('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: timezone,
              }).format(new Date(data.generatedAt))}
            />
          }
          tone={data.ready ? 'success' : 'neutral'}
        />
      </SummaryStrip>
      <div className="setup-workspace">
        <div className="setup-main">
          {data.ready ? (
            <section className="setup-ready" aria-labelledby="setup-ready-title">
              <CircleCheckBig aria-hidden="true" />
              <div>
                <h2 id="setup-ready-title">Siap beroperasi</h2>
                <p>Persiapan telah selesai.</p>
              </div>
            </section>
          ) : (
            <SetupBlockerPanel
              groups={groups}
              total={data.blockers.length}
              openKeys={openKeys}
              onOpenKeysChange={setOpenKeys}
            />
          )}
        </div>
        <ContextRail
          eyebrow="Kesiapan"
          title="Area setup"
          className="setup-area-rail"
          footer={
            nextArea ? (
              <Link className="setup-area-rail__next" to={nextArea.to}>
                Buka {nextArea.label} <ArrowRight aria-hidden="true" />
              </Link>
            ) : undefined
          }
        >
          <ol className="setup-area-list">
            {data.areas.map((area, index) => {
              const meta = setupAreaMeta[area.area];
              const group = groups.find((item) => item.area === area.area);
              const optional = area.requiredCount === 0;
              const status = optional ? 'optional' : area.ready ? 'ready' : 'pending';
              return (
                <li key={area.area} className={`setup-area-row is-${status}`}>
                  <span className="setup-area-row__marker" aria-hidden="true">
                    {status === 'ready' ? <Check /> : index + 1}
                  </span>
                  <Link className="setup-area-row__link" to={meta.to}>
                    <strong>{meta.label}</strong>
                    <small>
                      {optional
                        ? `${area.activeCount} ${area.area === 'CHECKLISTS' ? 'kategori' : 'part'} · opsional`
                        : area.ready
                          ? `${area.activeCount} data aktif · lengkap`
                          : `${area.activeCount}/${area.requiredCount} minimum`}
                    </small>
                  </Link>
                  {group ? (
                    <button
                      type="button"
                      className="setup-count-chip is-action"
                      aria-label={`Tampilkan ${group.count} blocker ${meta.label}`}
                      onClick={() => revealArea(group)}
                    >
                      {group.count}
                    </button>
                  ) : (
                    <span className="setup-area-row__state">
                      {optional ? 'Opsional' : 'Selesai'}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </ContextRail>
      </div>
    </>
  );
}
