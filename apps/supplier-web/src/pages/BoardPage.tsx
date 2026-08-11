import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Radio,
  RefreshCw,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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

export function BoardPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [connection, setConnection] = useState<RealtimeConnectionState>('connecting');
  const lineId = params.get('lineId') ?? undefined;
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const boardKey = useMemo(
    () => scopedKey(scope, 'assignment-board', { lineId }),
    [lineId, scope.purpose, scope.supplierId, scope.userId],
  );
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => supplierApi.board({ ...(lineId ? { lineId } : {}) }),
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

  const lines = board.data?.lines ?? [];
  const jobs = lines.flatMap((line) => line.jobs);
  const openIndicators = jobs
    .flatMap((job) => job.indicators)
    .filter((item) => item.status === 'OPEN').length;
  const issues = jobs.filter((job) => job.state === 'VACANT' || job.state === 'CONFLICTED').length;
  const operationalRisks = boardOperationalRisks(lines);
  const contextLine = lines[0];

  return (
    <div className="product-page board-page">
      <PageHeader
        eyebrow="Realtime monitoring"
        title="Assignment Board Supplier"
        description="Working Assignment dan active change state untuk Shift Run dalam scope Anda."
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
              ? 'Menyambungkan realtime'
              : connection === 'resyncing'
                ? 'Menyinkronkan ulang data'
                : 'Data mungkin stale'
          }
        >
          {connection === 'connecting'
            ? 'Board sedang membuka koneksi event.'
            : connection === 'resyncing'
              ? 'Cursor event tidak tersedia. Board sedang mengambil ulang data authoritative.'
              : 'Koneksi event terputus. Data authoritative terakhir tetap ditampilkan.'}
          {connection === 'disconnected' && (
            <Button size="sm" variant="ghost" onClick={() => realtime.reconnect()}>
              Sambungkan ulang
            </Button>
          )}
        </Alert>
      )}
      <div className="board-toolbar">
        <label>
          <span>Line dalam scope</span>
          <NativeSelect
            value={lineId ?? ''}
            onChange={(event) =>
              setParams(event.target.value ? { lineId: event.target.value } : {}, { replace: true })
            }
          >
            <option value="">Semua line</option>
            {board.data?.lines.map((line) => (
              <option key={line.lineId} value={line.lineId}>
                {line.lineCode} · {line.lineName}
              </option>
            ))}
          </NativeSelect>
        </label>
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
          description="Coba refetch. Scope line tidak diperluas oleh filter browser."
          action={<Button onClick={() => void board.refetch()}>Coba lagi</Button>}
        />
      )}
      {board.data && lines.length === 0 && (
        <EmptyState
          title="Tidak ada shift aktif"
          description="Board akan terisi setelah Shift Run pada line dalam scope menjadi Active."
        />
      )}
      {board.data && lines.length > 0 && (
        <div className="board-workspace">
          <div className="board-workspace__main">
            <SummaryStrip label="Ringkasan Assignment Board" className="board-metrics">
              <SummaryMetric label="Line aktif" value={lines.length} icon={<Users />} />
              <SummaryMetric label="Job aktif" value={jobs.length} icon={<CheckCircle2 />} />
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
            <div className="board-lines">
              {lines.map((line) => (
                <section key={line.shiftRunId} className="board-line">
                  <header>
                    <div>
                      <span>{line.lineCode}</span>
                      <h2>{line.lineName}</h2>
                      <p>
                        {line.shiftName} · {line.businessDate}
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
                    <Link to={`/shifts/${line.shiftRunId}`}>Detail Shift</Link>
                  </header>
                  {line.activeOverride && (
                    <Alert tone="danger" title="Emergency Start aktif">
                      {line.activeOverride.reason} · {line.activeOverride.unresolvedIssueCount}{' '}
                      issue belum selesai.
                    </Alert>
                  )}
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
                            <small>{job.mp.registrationNumber ?? humanize(job.state)}</small>
                          </span>
                        </div>
                        <div className="board-job__status">
                          <span>{humanize(job.state)}</span>
                          <div role="group" aria-label={`${job.indicators.length} Henkaten aktif`}>
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
          </div>
          <ContextRail
            eyebrow="Konteks authoritative"
            title="Status operasional"
            footer={
              contextLine && (
                <Link
                  className="hds-button hds-button--secondary hds-button--sm"
                  to={`/shifts/${contextLine.shiftRunId}`}
                >
                  Buka detail Shift
                </Link>
              )
            }
          >
            {operationalRisks.length ? (
              <section className="board-critical">
                <h3>Issue dan reservation</h3>
                {operationalRisks.slice(0, 6).map((risk) => (
                  <div key={risk.key}>
                    <AlertTriangle aria-hidden="true" />
                    <span>
                      <strong>{risk.jobName}</strong>
                      <small>{risk.label}</small>
                    </span>
                    <BoardRiskAction risk={risk} />
                  </div>
                ))}
              </section>
            ) : (
              <Alert tone="success" title="Assignment stabil">
                Tidak ada vacancy, conflict, atau reservation pada scope ini.
              </Alert>
            )}
            {contextLine && (
              <FactStrip label="Ringkasan Shift aktif">
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
            <section className="board-legend">
              <h3>Legenda status</h3>
              <span>
                <i className="is-assigned" /> Assigned
              </span>
              <span>
                <i className="is-vacant" /> Vacant
              </span>
              <span>
                <i className="is-reserved" /> Reserved
              </span>
              <span>
                <i className="is-conflicted" /> Conflicted
              </span>
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
    line.jobs.flatMap((job) => [
      ...(job.state === 'VACANT' || job.state === 'CONFLICTED'
        ? [
            {
              key: `assignment:${job.assignmentId}`,
              kind: 'ISSUE' as const,
              jobName: job.jobName,
              label: `Assignment issue · ${humanize(job.state)}`,
              henkatenId: null,
              resolutionShiftRunId: line.shiftRunId,
            },
          ]
        : []),
      ...job.indicators
        .filter((indicator) => indicator.category === 'MAN' && indicator.status === 'OPEN')
        .map((indicator) => ({
          key: `reservation:${indicator.henkatenId}`,
          kind: 'RESERVATION' as const,
          jobName: job.jobName,
          label: `Reservation aktif · ${indicator.identifier}`,
          henkatenId: indicator.henkatenId,
          resolutionShiftRunId: null,
        })),
    ]),
  );
}

export function BoardRiskAction({
  risk,
}: {
  risk: ReturnType<typeof boardOperationalRisks>[number];
}) {
  return risk.kind === 'RESERVATION' ? (
    <Link
      className="hds-button hds-button--secondary hds-button--sm board-risk-action"
      to={`/henkatens/${risk.henkatenId}`}
    >
      <FileText aria-hidden="true" />
      Buka Henkaten
      <ArrowRight aria-hidden="true" />
    </Link>
  ) : (
    <Link
      className="hds-button hds-button--primary hds-button--sm board-risk-action"
      to={`/shifts/${risk.resolutionShiftRunId}/resolve`}
    >
      <Wrench aria-hidden="true" />
      Buka resolusi
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
