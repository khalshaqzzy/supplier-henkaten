import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileClock,
  FolderOpen,
  ShieldCheck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import type { DashboardQuery } from '@tmmin-henkaten/contracts';
import {
  Alert,
  Button,
  ChartFrame,
  EmptyState,
  ErrorState,
  FilterBar,
  Input,
  LastUpdated,
  NativeSelect,
  Panel,
  Skeleton,
  StatCard,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';

export function OverviewPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const identity = session!.principal;
  const supplier = session!.supplier!;
  const from = params.get('from');
  const to = params.get('to');
  const query: DashboardQuery = {
    ...(from ? { from: new Date(`${from}T00:00:00.000Z`).toISOString() } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999Z`).toISOString() } : {}),
    ...(params.get('status') ? { status: params.get('status') as DashboardQuery['status'] } : {}),
    ...(params.get('category')
      ? { category: params.get('category') as DashboardQuery['category'] }
      : {}),
    ...(params.get('lineId') ? { lineId: params.get('lineId')! } : {}),
    ...(params.get('part') ? { part: params.get('part')! } : {}),
    ...(params.get('shiftTemplateId') ? { shiftTemplateId: params.get('shiftTemplateId')! } : {}),
    ...(params.get('approvalRoute')
      ? { approvalRoute: params.get('approvalRoute') as DashboardQuery['approvalRoute'] }
      : {}),
    ...(params.get('approvalStatus')
      ? { approvalStatus: params.get('approvalStatus') as DashboardQuery['approvalStatus'] }
      : {}),
    granularity: (params.get('granularity') as DashboardQuery['granularity']) || 'DAY',
  };
  const dashboard = useQuery({
    queryKey: scopedKey(
      { userId: identity.userId, supplierId: supplier.id, purpose: identity.purpose },
      'dashboard',
      query,
    ),
    queryFn: () => supplierApi.dashboard(query),
  });

  return (
    <div className="product-page">
      <PageHeader
        eyebrow={identity.purpose === 'HOSTED_PREPARATION' ? 'Mode persiapan' : 'Operasi Hosted'}
        title="Supplier Overview"
        description="Pantau Henkaten, approval, dan risiko operasional sesuai scope Anda."
        actions={
          identity.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/henkatens/new">
              Buat Henkaten
            </Link>
          ) : undefined
        }
      />
      <FilterBar>
        <label>
          <span>Dari tanggal</span>
          <Input
            type="date"
            value={from ?? ''}
            onChange={(event) => updateParam(params, setParams, 'from', event.target.value)}
          />
        </label>
        <label>
          <span>Sampai tanggal</span>
          <Input
            type="date"
            value={to ?? ''}
            onChange={(event) => updateParam(params, setParams, 'to', event.target.value)}
          />
        </label>
        <label>
          <span>Status</span>
          <NativeSelect
            value={params.get('status') ?? ''}
            onChange={(event) => updateParam(params, setParams, 'status', event.target.value)}
          >
            <option value="">Semua status</option>
            <option value="OPEN">Open</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </NativeSelect>
        </label>
        <label>
          <span>Kategori 4M</span>
          <NativeSelect
            value={params.get('category') ?? ''}
            onChange={(event) => updateParam(params, setParams, 'category', event.target.value)}
          >
            <option value="">Semua kategori</option>
            <option value="MAN">Man</option>
            <option value="MACHINE">Machine</option>
            <option value="MATERIAL">Material</option>
            <option value="METHOD">Method</option>
          </NativeSelect>
        </label>
        <label>
          <span>Interval tren</span>
          <NativeSelect
            value={params.get('granularity') ?? 'DAY'}
            onChange={(event) => updateParam(params, setParams, 'granularity', event.target.value)}
          >
            <option value="DAY">Harian</option>
            <option value="WEEK">Mingguan</option>
            <option value="MONTH">Bulanan</option>
          </NativeSelect>
        </label>
        <label>
          <span>Line</span>
          <NativeSelect
            value={params.get('lineId') ?? ''}
            onChange={(event) => updateParam(params, setParams, 'lineId', event.target.value)}
          >
            <option value="">Semua line</option>
            {dashboard.data?.filterOptions.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Shift Template</span>
          <NativeSelect
            value={params.get('shiftTemplateId') ?? ''}
            onChange={(event) =>
              updateParam(params, setParams, 'shiftTemplateId', event.target.value)
            }
          >
            <option value="">Semua shift</option>
            {dashboard.data?.filterOptions.shiftTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Part</span>
          <Input
            value={params.get('part') ?? ''}
            placeholder="Nomor atau nama"
            onChange={(event) => updateParam(params, setParams, 'part', event.target.value)}
          />
        </label>
        <label>
          <span>Approval route</span>
          <NativeSelect
            value={params.get('approvalRoute') ?? ''}
            onChange={(event) =>
              updateParam(params, setParams, 'approvalRoute', event.target.value)
            }
          >
            <option value="">Semua route</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="QC">QC</option>
          </NativeSelect>
        </label>
        <label>
          <span>Approval status</span>
          <NativeSelect
            value={params.get('approvalStatus') ?? ''}
            onChange={(event) =>
              updateParam(params, setParams, 'approvalStatus', event.target.value)
            }
          >
            <option value="">Semua status</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="NOT_REQUIRED">Not Required</option>
          </NativeSelect>
        </label>
        {dashboard.data && (
          <LastUpdated value={formatTime(dashboard.data.generatedAt, supplier.timezone)} />
        )}
      </FilterBar>
      {dashboard.isLoading && <OverviewSkeleton />}
      {dashboard.isError && (
        <ErrorState
          title="Overview tidak dapat dimuat"
          description="Data lama tidak diubah menjadi nol. Coba muat ulang overview."
          action={<Button onClick={() => void dashboard.refetch()}>Coba lagi</Button>}
        />
      )}
      {dashboard.data && (
        <>
          <section className="overview-stats" aria-label="Ringkasan Henkaten">
            <StatCard
              label="Open Henkaten"
              value={dashboard.data.totals.open}
              icon={<FolderOpen />}
              tone="info"
            />
            <StatCard
              label="Approved"
              value={dashboard.data.totals.approved}
              icon={<CheckCircle2 />}
              tone="success"
            />
            <StatCard
              label="Rejected / Cancelled"
              value={dashboard.data.totals.rejected + dashboard.data.totals.cancelled}
              icon={<AlertTriangle />}
              tone="danger"
            />
            <StatCard
              label="Warning aktif"
              value={dashboard.data.totals.activeWarnings}
              icon={<AlertTriangle />}
              tone="warning"
            />
            <StatCard
              label="Pending Supervisor"
              value={dashboard.data.pendingApprovals.supervisor}
              icon={<ShieldCheck />}
              tone="info"
            />
            <StatCard
              label="Pending QC"
              value={dashboard.data.pendingApprovals.qc}
              icon={<Clock3 />}
              tone="warning"
            />
          </section>
          {dashboard.data.totals.all === 0 ? (
            <EmptyState
              title="Belum ada Henkaten"
              description="Mulai dari setup dan Start Shift sebelum membuat Henkaten pertama."
              action={<Link to="/setup">Buka setup</Link>}
            />
          ) : (
            <section className="overview-grid">
              <Panel title="Approval aging" description="Route approval yang masih pending.">
                <div className="aging-grid">
                  {dashboard.data.approvalAging.map((item) => (
                    <div key={item.bucket}>
                      <span>{agingLabel(item.bucket)}</span>
                      <strong>{item.count}</strong>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Tren Henkaten 4M" className="overview-grid__wide">
                <ChartFrame
                  title="Volume per periode"
                  data={dashboard.data.trend.map((item) => ({
                    ...item,
                    period: new Intl.DateTimeFormat('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      timeZone: supplier.timezone,
                    }).format(new Date(item.periodStart)),
                  }))}
                  xKey="period"
                  series={[
                    { dataKey: 'man', label: 'Man', color: 'var(--hds-4m-man)' },
                    { dataKey: 'machine', label: 'Machine', color: 'var(--hds-4m-machine)' },
                    { dataKey: 'material', label: 'Material', color: 'var(--hds-4m-material)' },
                    { dataKey: 'method', label: 'Method', color: 'var(--hds-4m-method)' },
                  ]}
                />
              </Panel>
              <Panel title="Assignment issue">
                <div className="metric-list">
                  {dashboard.data.assignmentIssues.map((item) => (
                    <Link key={item.type} to="/shifts">
                      <span>
                        {item.type === 'VACANCY' ? 'Posisi kosong' : 'Konflik assignment'}
                      </span>
                      <strong>{item.count}</strong>
                    </Link>
                  ))}
                  {!dashboard.data.assignmentIssues.length && <span>Tidak ada issue terbuka.</span>}
                </div>
              </Panel>
              <Panel title="Emergency override">
                {dashboard.data.recentOverrides.length ? (
                  <div className="metric-list">
                    {dashboard.data.recentOverrides.slice(0, 4).map((item) => (
                      <Link key={item.shiftRunId} to={`/shifts/${item.shiftRunId}`}>
                        <span>{item.lineName}</span>
                        <strong>{item.businessDate}</strong>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Alert tone="success" title="Tidak ada override">
                    Tidak ada Emergency Start pada scope saat ini.
                  </Alert>
                )}
              </Panel>
              <Panel title="Aktivitas terbaru" className="overview-grid__wide">
                <ol className="activity-list">
                  {dashboard.data.recentActivity.map((item) => (
                    <li key={item.id}>
                      <FileClock aria-hidden="true" />
                      <span>
                        <strong>{humanizeAction(item.action)}</strong>
                        <small>{formatTime(item.occurredAt, supplier.timezone)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="overview-skeleton" aria-label="Memuat overview">
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

function updateParam(
  params: URLSearchParams,
  setParams: ReturnType<typeof useSearchParams>[1],
  key: string,
  value: string,
) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete('cursor');
  setParams(next, { replace: true });
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function agingLabel(bucket: string) {
  return (
    {
      UNDER_4_HOURS: '0–4 jam',
      FOUR_TO_EIGHT_HOURS: '4–8 jam',
      EIGHT_TO_24_HOURS: '8–24 jam',
      OVER_24_HOURS: '>24 jam',
    }[bucket] ?? bucket
  );
}

function humanizeAction(action: string) {
  return action
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
