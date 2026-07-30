import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Factory,
  FolderOpen,
  ListFilter,
  ShieldCheck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import {
  ApprovalAgingDistribution,
  RankedDistribution,
  RecentActivityFeed,
} from '../components/OverviewDashboard';
import { SummaryMetric, SummaryStrip } from '../components/OperationalUI';

export function OverviewPage() {
  const { session, hasCapability } = useSession();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  const [activityExpanded, setActivityExpanded] = useState(false);
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
  useEffect(() => {
    setDraft(new URLSearchParams(params));
    setActivityExpanded(false);
  }, [params]);

  return (
    <div className="product-page">
      <PageHeader
        eyebrow={identity.purpose === 'HOSTED_PREPARATION' ? 'Mode persiapan' : 'Operasi Hosted'}
        title="Overview Supplier"
        description="Pantau Henkaten, approval, dan risiko operasional sesuai scope Anda."
        actions={
          identity.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/henkatens/new">
              Buat Henkaten
            </Link>
          ) : undefined
        }
      />
      <div className="overview-filter-shell">
        <FilterBar>
          <label className="overview-filter overview-filter--from">
            <span>Dari tanggal</span>
            <Input
              type="date"
              value={draft.get('from') ?? ''}
              onChange={(event) => updateDraft(draft, setDraft, 'from', event.target.value)}
            />
          </label>
          <label className="overview-filter overview-filter--to">
            <span>Sampai tanggal</span>
            <Input
              type="date"
              value={draft.get('to') ?? ''}
              onChange={(event) => updateDraft(draft, setDraft, 'to', event.target.value)}
            />
          </label>
          <label className="overview-filter overview-filter--status">
            <span>Status</span>
            <NativeSelect
              value={draft.get('status') ?? ''}
              onChange={(event) => updateDraft(draft, setDraft, 'status', event.target.value)}
            >
              <option value="">Semua status</option>
              <option value="OPEN">Open</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </NativeSelect>
          </label>
          <label className="overview-filter overview-filter--category">
            <span>Kategori 4M</span>
            <NativeSelect
              value={draft.get('category') ?? ''}
              onChange={(event) => updateDraft(draft, setDraft, 'category', event.target.value)}
            >
              <option value="">Semua kategori</option>
              <option value="MAN">Man</option>
              <option value="MACHINE">Machine</option>
              <option value="MATERIAL">Material</option>
              <option value="METHOD">Method</option>
            </NativeSelect>
          </label>
          <label className="overview-filter overview-filter--granularity">
            <span>Interval tren</span>
            <NativeSelect
              value={draft.get('granularity') ?? 'DAY'}
              onChange={(event) => updateDraft(draft, setDraft, 'granularity', event.target.value)}
            >
              <option value="DAY">Harian</option>
              <option value="WEEK">Mingguan</option>
              <option value="MONTH">Bulanan</option>
            </NativeSelect>
          </label>
          <div className="overview-filter-updated">
            {dashboard.data && (
              <LastUpdated value={formatTime(dashboard.data.generatedAt, supplier.timezone)} />
            )}
          </div>
          <label className="overview-filter overview-filter--line">
            <span>Line</span>
            <NativeSelect
              value={draft.get('lineId') ?? ''}
              onChange={(event) => updateDraft(draft, setDraft, 'lineId', event.target.value)}
            >
              <option value="">Semua line</option>
              {dashboard.data?.filterOptions.lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.code} · {line.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="overview-filter overview-filter--shift">
            <span>Shift Template</span>
            <NativeSelect
              value={draft.get('shiftTemplateId') ?? ''}
              onChange={(event) =>
                updateDraft(draft, setDraft, 'shiftTemplateId', event.target.value)
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
          <label className="overview-filter overview-filter--part">
            <span>Part</span>
            <Input
              value={draft.get('part') ?? ''}
              placeholder="Nomor atau nama"
              onChange={(event) => updateDraft(draft, setDraft, 'part', event.target.value)}
            />
          </label>
          <label className="overview-filter overview-filter--route">
            <span>Approval route</span>
            <NativeSelect
              value={draft.get('approvalRoute') ?? ''}
              onChange={(event) =>
                updateDraft(draft, setDraft, 'approvalRoute', event.target.value)
              }
            >
              <option value="">Semua route</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="QC">QC</option>
            </NativeSelect>
          </label>
          <label className="overview-filter overview-filter--approval">
            <span>Approval status</span>
            <NativeSelect
              value={draft.get('approvalStatus') ?? ''}
              onChange={(event) =>
                updateDraft(draft, setDraft, 'approvalStatus', event.target.value)
              }
            >
              <option value="">Semua status</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="NOT_REQUIRED">Not Required</option>
            </NativeSelect>
          </label>
          <div className="overview-filter-actions">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(new URLSearchParams());
                setActivityExpanded(false);
                setParams({}, { replace: true });
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              leadingIcon={<ListFilter />}
              onClick={() => {
                const next = new URLSearchParams(draft);
                next.delete('cursor');
                setActivityExpanded(false);
                setParams(next, { replace: true });
              }}
            >
              Terapkan
            </Button>
          </div>
        </FilterBar>
      </div>
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
          <SummaryStrip label="Ringkasan Henkaten" className="overview-stats">
            <SummaryMetric
              label="Open Henkaten"
              value={dashboard.data.totals.open}
              icon={<FolderOpen />}
              tone="info"
            />
            <SummaryMetric
              label="Approved"
              value={dashboard.data.totals.approved}
              icon={<CheckCircle2 />}
              tone="success"
            />
            <SummaryMetric
              label="Rejected / Cancelled"
              value={dashboard.data.totals.rejected + dashboard.data.totals.cancelled}
              icon={<AlertTriangle />}
              tone="danger"
            />
            <SummaryMetric
              label="Warning aktif"
              value={dashboard.data.totals.activeWarnings}
              icon={<AlertTriangle />}
              tone="warning"
            />
            <SummaryMetric
              label="Pending Supervisor"
              value={dashboard.data.pendingApprovals.supervisor}
              icon={<ShieldCheck />}
              tone="info"
            />
            <SummaryMetric
              label="Pending QC"
              value={dashboard.data.pendingApprovals.qc}
              icon={<Clock3 />}
              tone="warning"
            />
          </SummaryStrip>
          {dashboard.data.totals.all === 0 ? (
            <EmptyState
              title="Belum ada Henkaten"
              description="Mulai dari setup dan Start Shift sebelum membuat Henkaten pertama."
              action={<Link to="/setup">Buka setup</Link>}
            />
          ) : (
            <section className="overview-grid">
              <ApprovalAgingDistribution
                items={dashboard.data.approvalAging}
                showApprovalLink={hasCapability('SUPPLIER_HENKATEN_DECIDE')}
              />
              <div className="overview-widget overview-widget--trend">
                <ChartFrame
                  title="Tren Henkaten 4M"
                  description="Volume kategori per periode pada scope aktif."
                  data={dashboard.data.trend.map((item) => ({
                    ...item,
                    period: formatTrendPeriod(
                      item.periodStart,
                      query.granularity,
                      supplier.timezone,
                    ),
                  }))}
                  xKey="period"
                  series={[
                    { dataKey: 'man', label: 'Man', color: 'var(--hds-4m-man)' },
                    { dataKey: 'machine', label: 'Machine', color: 'var(--hds-4m-machine)' },
                    { dataKey: 'material', label: 'Material', color: 'var(--hds-4m-material)' },
                    { dataKey: 'method', label: 'Method', color: 'var(--hds-4m-method)' },
                  ]}
                />
              </div>
              <RankedDistribution
                title="Henkaten per line"
                description="Line dengan volume tertinggi."
                items={dashboard.data.byLine}
                emptyLabel="Belum ada distribusi line"
                layout="line"
              />
              <RankedDistribution
                title="Henkaten per part"
                description="Part dengan Henkaten terbanyak."
                items={dashboard.data.byPart}
                emptyLabel="Belum ada distribusi part"
                layout="part"
              />
              <div className="overview-widget overview-widget--outcome">
                <ChartFrame
                  title="Tren outcome"
                  description="Keputusan terminal per periode."
                  data={dashboard.data.trend.map((item) => ({
                    ...item,
                    period: formatTrendPeriod(
                      item.periodStart,
                      query.granularity,
                      supplier.timezone,
                    ),
                  }))}
                  xKey="period"
                  kind="bar"
                  series={[
                    {
                      dataKey: 'approved',
                      label: 'Approved',
                      color: 'var(--hds-state-success-accent)',
                    },
                    {
                      dataKey: 'rejected',
                      label: 'Rejected',
                      color: 'var(--hds-state-danger-accent)',
                    },
                    {
                      dataKey: 'cancelled',
                      label: 'Cancelled',
                      color: 'var(--hds-color-slate-400)',
                    },
                  ]}
                />
              </div>
              <Panel
                title="Assignment issue"
                description="Issue yang masih membutuhkan resolusi."
                className="overview-widget overview-widget--issues"
                action={
                  hasCapability('SUPPLIER_SHIFT_READ') ? (
                    <Link className="overview-widget-link" to="/shifts">
                      Buka Shift
                    </Link>
                  ) : undefined
                }
              >
                {dashboard.data.assignmentIssues.length ? (
                  <div className="overview-operational-list">
                    {dashboard.data.assignmentIssues.map((item) => (
                      <div key={item.type}>
                        <span className={item.type === 'VACANCY' ? 'is-danger' : 'is-warning'}>
                          <AlertTriangle aria-hidden="true" />
                        </span>
                        <div>
                          <strong>
                            {item.type === 'VACANCY' ? 'Posisi kosong' : 'Konflik assignment'}
                          </strong>
                          <small>Masih terbuka pada scope aktif</small>
                        </div>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert tone="success" title="Tidak ada issue terbuka">
                    Seluruh assignment pada scope saat ini dalam kondisi terkendali.
                  </Alert>
                )}
              </Panel>
              <Panel
                title="Emergency override"
                description={`${dashboard.data.totals.emergencyOverrides} override pada filter aktif.`}
                className="overview-widget overview-widget--overrides"
              >
                {dashboard.data.recentOverrides.length ? (
                  <div className="overview-override-list">
                    {dashboard.data.recentOverrides.slice(0, 4).map((item) => (
                      <Link key={item.shiftRunId} to={`/shifts/${item.shiftRunId}`}>
                        <span>
                          <strong>{item.lineName}</strong>
                          <small title={item.reason}>{item.reason}</small>
                        </span>
                        <time dateTime={item.startedAt}>
                          {formatTime(item.startedAt, supplier.timezone)}
                        </time>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Alert tone="success" title="Tidak ada override">
                    Tidak ada Emergency Start pada scope saat ini.
                  </Alert>
                )}
              </Panel>
              <RecentActivityFeed
                items={dashboard.data.recentActivity}
                expanded={activityExpanded}
                onExpandedChange={setActivityExpanded}
                timezone={supplier.timezone}
                canReadHenkaten={hasCapability('SUPPLIER_HENKATEN_READ')}
              />
            </section>
          )}
          <nav className="overview-quick-links" aria-label="Tautan cepat">
            <strong>Tautan cepat</strong>
            {hasCapability('SUPPLIER_BOARD_READ') && (
              <Link to="/board">
                <Factory aria-hidden="true" />
                Assignment Board
              </Link>
            )}
            {hasCapability('SUPPLIER_HENKATEN_READ') && (
              <Link to="/henkatens">
                <FolderOpen aria-hidden="true" />
                Open Henkaten
              </Link>
            )}
            {hasCapability('SUPPLIER_HENKATEN_DECIDE') && (
              <Link to="/approvals">
                <ShieldCheck aria-hidden="true" />
                Antrean Approval
              </Link>
            )}
            {hasCapability('SUPPLIER_SHIFT_READ') && (
              <Link to="/shifts">
                <Clock3 aria-hidden="true" />
                Ringkasan Shift
              </Link>
            )}
          </nav>
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

function updateDraft(
  params: URLSearchParams,
  setDraft: (value: URLSearchParams) => void,
  key: string,
  value: string,
) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  setDraft(next);
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function formatTrendPeriod(
  value: string,
  granularity: DashboardQuery['granularity'],
  timeZone: string,
) {
  const options: Intl.DateTimeFormatOptions =
    granularity === 'MONTH'
      ? { month: 'short', year: '2-digit', timeZone }
      : { day: '2-digit', month: 'short', timeZone };
  const label = new Intl.DateTimeFormat('id-ID', options).format(new Date(value));
  return granularity === 'WEEK' ? `Mgg ${label}` : label;
}
