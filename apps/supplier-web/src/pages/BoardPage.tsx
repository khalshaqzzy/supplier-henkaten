import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Radio,
  RefreshCw,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { HenkatenCategory, HenkatenStatus } from '@tmmin-henkaten/contracts';
import {
  createSupplierRealtimeClient,
  type RealtimeConnectionState,
} from '@tmmin-henkaten/api-client';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FourMDot,
  LastUpdated,
  NativeSelect,
  Skeleton,
} from '@tmmin-henkaten/ui';

import { supplierApi, supplierApiOrigin, supplierAssetUrl } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import {
  ContextRail,
  FactItem,
  FactStrip,
  SummaryMetric,
  SummaryStrip,
} from '../components/OperationalUI';

const BoardCanvas = lazy(() => import('../components/board-canvas/BoardCanvas'));

export function BoardPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [connection, setConnection] = useState<RealtimeConnectionState>('connecting');
  const [canvasDirty, setCanvasDirty] = useState(false);
  const lineId = params.get('lineId') ?? undefined;
  const shiftStatus =
    params.get('shiftStatus') === 'OTHER' || params.get('shiftStatus') === 'ALL'
      ? (params.get('shiftStatus') as 'OTHER' | 'ALL')
      : 'CURRENT';
  const view = params.get('view') === 'canvas' ? 'canvas' : 'default';
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const boardKey = useMemo(
    () => scopedKey(scope, 'assignment-board'),
    [scope.purpose, scope.supplierId, scope.userId],
  );
  const board = useQuery({
    queryKey: [...boardKey, shiftStatus],
    queryFn: () => supplierApi.board({ shiftStatus }),
  });
  const realtime = useMemo(
    () =>
      createSupplierRealtimeClient({
        baseUrl: supplierApiOrigin,
        query: { ...(lineId ? { lineId } : {}) },
        onStateChange: setConnection,
        onInvalidate: (event) => {
          if (event.refresh.includes('assignment-board'))
            void queryClient.invalidateQueries({ queryKey: boardKey });
          if (event.refresh.includes('assignment-board-layout'))
            void queryClient.invalidateQueries({
              queryKey: scopedKey(scope, 'assignment-board-layout'),
            });
          if (event.refresh.includes('notifications'))
            void queryClient.invalidateQueries({
              queryKey: scopedKey(scope, 'notification-count'),
            });
          if (event.refresh.includes('dashboard'))
            void queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'dashboard') });
        },
        onReconnect: () => void queryClient.invalidateQueries({ queryKey: boardKey }),
        onResync: () => queryClient.invalidateQueries({ queryKey: boardKey }),
      }),
    [boardKey, lineId, queryClient, scope.purpose, scope.supplierId, scope.userId],
  );
  useEffect(() => {
    realtime.connect();
    return () => realtime.close();
  }, [realtime]);

  const allLines = board.data?.lines ?? [];
  const lines = lineId ? allLines.filter((line) => line.lineId === lineId) : allLines;
  const jobs = lines.flatMap((line) => line.jobs);
  const openIndicators = jobs
    .flatMap((job) => job.indicators)
    .filter((item) => item.status === 'OPEN').length;
  const issues = jobs.filter((job) => job.state === 'VACANT' || job.state === 'CONFLICTED').length;
  const contextLine = lines[0];

  return (
    <div className="product-page board-page">
      <PageHeader
        eyebrow="Operasional"
        title="Assignment Board Supplier"
        description=""
        actions={
          session!.principal.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/henkatens/new">
              Buat Henkaten
            </Link>
          ) : undefined
        }
      />
      {connection !== 'connected' && (
        <Alert
          tone="warning"
          title={
            connection === 'connecting'
              ? 'Menghubungkan'
              : connection === 'resyncing'
                ? 'Memperbarui data'
                : 'Koneksi terputus'
          }
        >
          Coba sambungkan ulang atau perbarui data.
          {connection === 'disconnected' && (
            <Button size="sm" variant="ghost" onClick={() => realtime.reconnect()}>
              Sambungkan ulang
            </Button>
          )}
        </Alert>
      )}
      <div className="board-toolbar">
        <label>
          <span>Shift</span>
          <NativeSelect
            aria-label="Filter shift"
            value={shiftStatus}
            onChange={(event) => {
              if (
                canvasDirty &&
                !window.confirm('Ganti shift dan buang perubahan Canvas yang belum disimpan?')
              )
                return;
              const next = new URLSearchParams(params);
              if (event.target.value === 'CURRENT') next.delete('shiftStatus');
              else next.set('shiftStatus', event.target.value);
              next.delete('view');
              setParams(next, { replace: true });
            }}
          >
            <option value="CURRENT">Sedang aktif</option>
            <option value="OTHER">Shift lain</option>
            <option value="ALL">Semua shift</option>
          </NativeSelect>
        </label>
        <label>
          <span>Line dalam scope</span>
          <NativeSelect
            value={lineId ?? ''}
            onChange={(event) => {
              if (
                canvasDirty &&
                !window.confirm('Ganti line dan buang perubahan Canvas yang belum disimpan?')
              )
                return;
              const nextLineId = event.target.value;
              const next = new URLSearchParams(params);
              if (nextLineId) next.set('lineId', nextLineId);
              else {
                next.delete('lineId');
                next.delete('view');
              }
              setParams(next, { replace: true });
            }}
          >
            <option value="">Semua line</option>
            {allLines.map((line) => (
              <option key={line.lineId} value={line.lineId}>
                {line.lineCode} · {line.lineName}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="board-view-toggle" role="group" aria-label="Tampilan assignment board">
          <Button
            size="sm"
            variant={view === 'default' ? 'primary' : 'ghost'}
            aria-pressed={view === 'default'}
            onClick={() => {
              if (
                canvasDirty &&
                !window.confirm(
                  'Kembali ke Default dan buang perubahan Canvas yang belum disimpan?',
                )
              )
                return;
              const next = new URLSearchParams(params);
              next.delete('view');
              setParams(next, { replace: true });
            }}
          >
            Default
          </Button>
          <Button
            size="sm"
            variant={view === 'canvas' ? 'primary' : 'ghost'}
            aria-pressed={view === 'canvas'}
            disabled={!lineId || lines.length !== 1}
            title={
              lineId && lines.length === 1
                ? 'Buka Canvas'
                : 'Pilih satu line dan satu shift untuk membuka Canvas'
            }
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('view', 'canvas');
              setParams(next, { replace: true });
            }}
          >
            Canvas
          </Button>
        </div>
        <span className={`realtime-state is-${connection}`}>
          <Radio aria-hidden="true" />
          {connection === 'connected'
            ? 'Live'
            : connection === 'connecting'
              ? 'Connecting'
              : connection === 'resyncing'
                ? 'Resyncing'
                : 'Disconnected'}
        </span>
        {board.data && (
          <LastUpdated
            value={formatTime(board.data.lastUpdatedAt, session!.supplier!.timezone)}
            stale={connection === 'disconnected'}
          />
        )}
        <Button
          variant="secondary"
          leadingIcon={<RefreshCw />}
          onClick={() => void board.refetch()}
        >
          Perbarui
        </Button>
      </div>
      {board.isLoading && (
        <div className="board-skeleton">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} />
          ))}
        </div>
      )}
      {board.isError && (
        <ErrorState
          title="Assignment Board tidak dapat dimuat"
          description=""
          action={<Button onClick={() => void board.refetch()}>Coba lagi</Button>}
        />
      )}
      {board.data && lines.length === 0 && (
        <EmptyState
          title={
            shiftStatus === 'CURRENT' ? 'Tidak ada shift yang sedang aktif' : 'Belum ada assignment'
          }
          description=""
        />
      )}
      {board.data && lines.length > 0 && (
        <div
          className={`board-workspace${view === 'canvas' && lines.length === 1 ? ' is-canvas' : ''}`}
        >
          <div className="board-workspace__main">
            <SummaryStrip label="Ringkasan Assignment Board" className="board-metrics">
              <SummaryMetric label="Line–shift" value={lines.length} icon={<Users />} />
              <SummaryMetric label="Job" value={jobs.length} icon={<CheckCircle2 />} />
              <SummaryMetric
                label="Open Henkaten"
                value={openIndicators}
                icon={<Radio />}
                tone={openIndicators ? 'warning' : 'neutral'}
              />
              <SummaryMetric
                label="Assignment issue"
                value={issues}
                icon={<AlertTriangle />}
                tone={issues ? 'danger' : 'neutral'}
              />
            </SummaryStrip>
            {view === 'canvas' && lines.length === 1 && contextLine ? (
              <Suspense
                fallback={
                  <div className="board-canvas-skeleton">
                    <Skeleton />
                    <Skeleton />
                    <Skeleton />
                  </div>
                }
              >
                <BoardCanvas line={contextLine} onDirtyChange={setCanvasDirty} />
              </Suspense>
            ) : (
              <div className="board-lines">
                {lines.map((line) => (
                  <section key={line.shiftRunId} className="board-line">
                    <header>
                      <div>
                        <span>{line.lineCode}</span>
                        <h2>{line.lineName}</h2>
                        <p>
                          {line.shiftName} · {line.businessDate}
                          <span
                            className={`board-shift-badge ${line.isCurrent ? 'is-current' : ''}`}
                          >
                            {line.isCurrent ? 'Sedang aktif' : 'Shift berikutnya'}
                          </span>
                        </p>
                      </div>
                      <dl>
                        <div>
                          <dt>Supervisor</dt>
                          <dd>{line.supervisor.name ?? 'Kosong'}</dd>
                        </div>
                        <div>
                          <dt>Line Leader</dt>
                          <dd>{line.lineLeader.name ?? 'Kosong'}</dd>
                        </div>
                      </dl>
                    </header>
                    <div className="board-job-grid">
                      {line.jobs.map((job) => (
                        <article
                          key={job.assignmentId}
                          className={`board-job is-${job.state.toLowerCase()}`}
                        >
                          <header>
                            <span>{String(job.displayOrder).padStart(2, '0')}</span>
                            <strong>{job.jobName}</strong>
                            {job.state === 'ASSIGNED' ? <CheckCircle2 /> : <AlertTriangle />}
                          </header>
                          <div className="board-job__person">
                            <i>
                              <BoardMpAvatar mp={job.mp} />
                            </i>
                            <span>
                              <strong>{job.mp.name ?? 'Vacant'}</strong>
                              <small>{humanize(job.state)}</small>
                            </span>
                          </div>
                          <div className="board-job__status">
                            <span>{humanize(job.state)}</span>
                            <div
                              role="group"
                              aria-label={`${job.indicators.length} Henkaten aktif`}
                            >
                              {job.indicators.map((indicator) => (
                                <BoardHenkatenIndicator
                                  key={indicator.henkatenId}
                                  indicator={indicator}
                                />
                              ))}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
          <ContextRail eyebrow="" title="Shift">
            {contextLine && (
              <FactStrip label="Shift berjalan">
                <FactItem label="Line" value={contextLine.lineCode} detail={contextLine.lineName} />
                <FactItem label="Shift" value={contextLine.shiftName} />
                <FactItem label="Business date" value={contextLine.businessDate} />
                <FactItem
                  label="Supervisor"
                  value={contextLine.supervisor.name ?? 'Belum assigned'}
                />
                <FactItem
                  label="Line Leader"
                  value={contextLine.lineLeader.name ?? 'Belum assigned'}
                />
              </FactStrip>
            )}
            <section className="board-legend" aria-label="Legenda 4M">
              <h3>Legenda 4M</h3>
              {(['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const).map((category) => (
                <span key={category}>
                  <FourMDot category={category} /> {humanize(category)}
                </span>
              ))}
            </section>
          </ContextRail>
        </div>
      )}
    </div>
  );
}

type BoardLines = NonNullable<Awaited<ReturnType<typeof supplierApi.board>>>['lines'];

function BoardMpAvatar({ mp }: { mp: BoardLines[number]['jobs'][number]['mp'] }) {
  const photoUrl = mp.photoThumbnailUrl ? supplierAssetUrl(mp.photoThumbnailUrl) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return photoUrl && failedUrl !== photoUrl ? (
    <img src={photoUrl} alt="" onError={() => setFailedUrl(photoUrl)} />
  ) : mp.initials ? (
    mp.initials
  ) : (
    <UserRound aria-hidden="true" />
  );
}

export function boardOperationalRisks(lines: BoardLines) {
  return lines.flatMap((line) =>
    line.jobs.flatMap((job) =>
      job.state === 'VACANT' || job.state === 'CONFLICTED'
        ? [
            {
              key: `assignment:${job.assignmentId}`,
              kind: 'ISSUE' as const,
              jobName: job.jobName,
              label: `Assignment issue · ${humanize(job.state)}`,
              henkatenId: null,
              lineId: line.lineId,
            },
          ]
        : [],
    ),
  );
}

export function BoardRiskAction({
  risk,
}: {
  risk: ReturnType<typeof boardOperationalRisks>[number];
}) {
  return (
    <Link
      className="hds-button hds-button--primary hds-button--sm board-risk-action"
      to={`/master-data/line-setup?lineId=${risk.lineId}`}
    >
      <Wrench aria-hidden="true" />
      Line Setup
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

export function BoardHenkatenIndicator({
  indicator,
}: {
  indicator: {
    henkatenId: string;
    identifier: string;
    category: HenkatenCategory;
    status: HenkatenStatus;
  };
}) {
  return (
    <Link
      to={`/henkatens/${indicator.henkatenId}`}
      className={`four-m is-${indicator.status.toLowerCase()}`}
      title={`${indicator.identifier}: ${indicator.category} ${indicator.status}`}
      aria-label={`${indicator.category} ${indicator.status}: ${indicator.identifier}`}
    >
      <FourMDot category={indicator.category} />
    </Link>
  );
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}
