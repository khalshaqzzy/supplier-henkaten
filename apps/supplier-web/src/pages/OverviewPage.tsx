import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Factory,
  FolderOpen,
  ListFilter,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { DashboardQuery } from '@tmmin-henkaten/contracts';
import {
  Button,
  ChartFrame,
  EmptyState,
  ErrorState,
  FilterBar,
  Input,
  LastUpdated,
  NativeSelect,
  Popover,
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
  const advancedCount =
    ['shiftTemplateId', 'part', 'approvalRoute', 'approvalStatus'].filter((key) => params.get(key))
      .length + (params.get('granularity') && params.get('granularity') !== 'DAY' ? 1 : 0);
  const applyFilters = () => {
    const next = new URLSearchParams(draft);
    next.delete('cursor');
    setActivityExpanded(false);
    setParams(next, { replace: true });
  };

  return (
    <div className="product-page">
      <PageHeader
        eyebrow={identity.purpose === 'HOSTED_PREPARATION' ? 'Persiapan' : 'Operasional'}
        title="Overview Supplier"
        description=""
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
          <Popover
            title="Periode"
            trigger={
              <button
                className="overview-filter-period"
                type="button"
                aria-label={`Periode: ${formatDateRange(draft.get('from'), draft.get('to'))}`}
              >
                <span>Periode</span>
                <span className="overview-filter-period__value">
                  <CalendarDays aria-hidden="true" />
                  <strong>{formatDateRange(draft.get('from'), draft.get('to'))}</strong>
                  <ChevronDown aria-hidden="true" />
                </span>
              </button>
            }
          >
            <div className="overview-filter-date-popover">
              <label className="overview-filter">
                <span>Dari tanggal</span>
                <Input
                  type="date"
                  value={draft.get('from') ?? ''}
                  onChange={(event) => updateDraft(draft, setDraft, 'from', event.target.value)}
                />
              </label>
              <label className="overview-filter">
                <span>Sampai tanggal</span>
                <Input
                  type="date"
                  value={draft.get('to') ?? ''}
                  onChange={(event) => updateDraft(draft, setDraft, 'to', event.target.value)}
                />
              </label>
            </div>
          </Popover>
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
          <Popover
            title="Filter lainnya"
            trigger={
              <button className="overview-filter-more" type="button">
                <SlidersHorizontal aria-hidden="true" />
                <span>Filter lainnya</span>
                {advancedCount > 0 && (
                  <span
                    className="overview-filter-count"
                    aria-label={`${advancedCount} filter aktif`}
                  >
                    {advancedCount}
                  </span>
                )}
              </button>
            }
          >
            <div className="overview-filter-advanced">
              <label className="overview-filter">
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
              <label className="overview-filter">
                <span>Part</span>
                <Input
                  value={draft.get('part') ?? ''}
                  placeholder="Nomor atau nama"
                  onChange={(event) => updateDraft(draft, setDraft, 'part', event.target.value)}
                />
              </label>
              <label className="overview-filter">
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
              <label className="overview-filter">
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
              <label className="overview-filter">
                <span>Interval tren</span>
                <NativeSelect
                  value={draft.get('granularity') ?? 'DAY'}
                  onChange={(event) =>
                    updateDraft(draft, setDraft, 'granularity', event.target.value)
                  }
                >
                  <option value="DAY">Harian</option>
                  <option value="WEEK">Mingguan</option>
                  <option value="MONTH">Bulanan</option>
                </NativeSelect>
              </label>
            </div>
          </Popover>
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
            <Button size="sm" variant="primary" leadingIcon={<ListFilter />} onClick={applyFilters}>
              Terapkan
            </Button>
          </div>
          {dashboard.data && (
            <div
              className="overview-filter-updated"
              role="status"
              aria-label={`Terakhir diperbarui ${formatTime(dashboard.data.generatedAt, supplier.timezone)}`}
              title={`Terakhir diperbarui ${formatTime(dashboard.data.generatedAt, supplier.timezone)}`}
            >
              <LastUpdated value={formatTime(dashboard.data.generatedAt, supplier.timezone)} />
              <Clock3 aria-hidden="true" />
            </div>
          )}
        </FilterBar>
      </div>
      {dashboard.isLoading && <OverviewSkeleton />}
      {dashboard.isError && (
        <ErrorState
          title="Overview tidak dapat dimuat"
          description=""
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
              description=""
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
                  description=""
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
                description=""
                items={dashboard.data.byLine}
                emptyLabel="Belum ada distribusi line"
                layout="line"
              />
              <RankedDistribution
                title="Henkaten per part"
                description=""
                items={dashboard.data.byPart}
                emptyLabel="Belum ada distribusi part"
                layout="part"
              />
              <div className="overview-widget overview-widget--outcome">
                <ChartFrame
                  title="Tren outcome"
                  description=""
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
          </nav>
        </>
      )}
    </div>
  );
}

function formatDateRange(from: string | null, to: string | null) {
  const compact = (date: string) => date.split('-').reverse().join('/');
  if (from && to) return `${compact(from)} – ${compact(to)}`;
  if (from) return `Mulai ${compact(from)}`;
  if (to) return `Sampai ${compact(to)}`;
  return 'Semua tanggal';
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
