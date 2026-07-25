import { AlertTriangle, CheckCircle2, Radio, RefreshCw, UserRound, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  createSupplierRealtimeClient,
  type RealtimeConnectionState,
} from '@tmmin-henkaten/api-client';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  LastUpdated,
  NativeSelect,
  Skeleton,
} from '@tmmin-henkaten/ui';

import { supplierApi, supplierApiOrigin } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';

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

  return (
    <div className="product-page board-page">
      <PageHeader
        eyebrow="Realtime monitoring"
        title="Supplier Assignment Board"
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
        <>
          <section className="board-metrics">
            <Metric label="Line aktif" value={lines.length} icon={<Users />} />
            <Metric label="Job aktif" value={jobs.length} icon={<CheckCircle2 />} />
            <Metric
              label="Open Henkaten"
              value={openIndicators}
              icon={<Radio />}
              tone={openIndicators ? 'warning' : undefined}
            />
            <Metric
              label="Assignment issue"
              value={issues}
              icon={<AlertTriangle />}
              tone={issues ? 'danger' : undefined}
            />
          </section>
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
                    {line.activeOverride.reason} · {line.activeOverride.unresolvedIssueCount} issue
                    belum selesai.
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
                          {job.mp.photoThumbnailUrl ? (
                            <img src={job.mp.photoThumbnailUrl} alt="" />
                          ) : job.mp.initials ? (
                            job.mp.initials
                          ) : (
                            <UserRound />
                          )}
                        </i>
                        <span>
                          <strong>{job.mp.name ?? 'Vacant'}</strong>
                          <small>{job.mp.registrationNumber ?? humanize(job.state)}</small>
                        </span>
                      </div>
                      <div className="board-job__status">
                        <span>{humanize(job.state)}</span>
                        <div aria-label={`${job.indicators.length} Henkaten aktif`}>
                          {job.indicators.map((indicator) => (
                            <Link
                              key={indicator.henkatenId}
                              to={`/henkatens/${indicator.henkatenId}`}
                              className={`four-m is-${indicator.category.toLowerCase()} is-${indicator.status.toLowerCase()}`}
                              title={`${indicator.identifier}: ${indicator.category} ${indicator.status}`}
                            >
                              {indicator.category[0]}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: string | undefined;
}) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
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
