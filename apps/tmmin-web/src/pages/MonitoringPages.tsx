import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BellRing,
  Boxes,
  Clock3,
  DatabaseZap,
  Factory,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  Alert,
  Button,
  Card,
  ChartFrame,
  KeyValueGrid,
  NativeSelect,
  Panel,
  Skeleton,
  StatCard,
  StatusBadge,
  Timeline,
} from '@tmmin-henkaten/ui';

import { tmminApi } from '../app/api';
import { tmminKey } from '../app/query';
import { useTmminSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { QueryState } from './StatePages';

export function OverviewPage() {
  const { session } = useTmminSession();
  const [params, setParams] = useSearchParams();
  const fallbackRange = useMemo(() => defaultDashboardRange(), []);
  const query = queryObject(params, [
    'supplierId',
    'sourceMode',
    'from',
    'to',
    'status',
    'category',
    'line',
    'part',
    'aging',
    'freshness',
    'granularity',
  ]);
  query.from ??= fallbackRange.from;
  query.to ??= fallbackRange.to;
  query.granularity ??= 'DAY';
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'dashboard', query),
    queryFn: () =>
      tmminApi.dashboard({ ...query, granularity: query.granularity ?? 'DAY' } as never),
  });
  return (
    <>
      <PageHeader
        eyebrow="Monitoring lintas supplier"
        title="Ringkasan Global"
        description="Pantau risiko, warning, dan freshness dari sumber Hosted dan External dalam satu tampilan."
        actions={
          <UpdatedAt
            value={result.data?.generatedAt}
            fetching={result.isFetching}
            retry={() => void result.refetch()}
          />
        }
      />
      <DashboardFilters
        key={params.toString()}
        params={params}
        suppliers={result.data?.filterOptions.suppliers ?? []}
        fallbackRange={fallbackRange}
        onApply={setParams}
      />
      {result.isLoading ? (
        <DashboardSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <>
          <div className="tmmin-kpi-grid">
            <section className="tmmin-source-kpi" aria-label="Supplier aktif berdasarkan sumber">
              <header>
                <Factory />
                <span>Supplier aktif berdasarkan sumber</span>
              </header>
              <div>
                <SourceMetric
                  label="Hosted"
                  value={result.data.suppliers.hosted}
                  total={result.data.suppliers.active}
                  tone="hosted"
                />
                <SourceMetric
                  label="External"
                  value={result.data.suppliers.external}
                  total={result.data.suppliers.active}
                  tone="external"
                />
              </div>
            </section>
            <DashboardMetric
              label="Supplier dengan warning"
              value={result.data.suppliers.withWarnings}
              detail="Perlu ditinjau"
              icon={<TriangleAlert />}
              tone="warning"
            />
            <DashboardMetric
              label="Open Henkaten"
              value={result.data.openHenkatens}
              detail="Lintas semua sumber"
              icon={<Boxes />}
              tone="orange"
            />
            <DashboardMetric
              label="Masalah aging"
              value={result.data.aging.find(({ bucket }) => bucket === 'OVER_24_HOURS')?.count ?? 0}
              detail="Lebih dari 24 jam"
              icon={<Clock3 />}
              tone="warning"
            />
            <DashboardMetric
              label="Affected parts"
              value={result.data.affectedParts}
              detail="Part dengan warning aktif"
              icon={<PackageSearch />}
              tone="violet"
            />
            <DashboardMetric
              label="Masalah freshness"
              value={
                result.data.freshnessSummary.warning +
                result.data.freshnessSummary.stale +
                result.data.freshnessSummary.noData
              }
              detail="Warning, stale, atau tanpa data"
              icon={<DatabaseZap />}
              tone="danger"
            />
          </div>
          <div className="tmmin-trend-grid">
            <Panel title="Tren Henkaten" description="Volume Hosted, External, dan total">
              <ChartFrame
                title=""
                data={result.data.trend.map((item) => ({
                  ...item,
                  bucket: trendLabel(item.bucketStart, query.granularity),
                }))}
                xKey="bucket"
                kind="line"
                series={[
                  { dataKey: 'hosted', label: 'Hosted', color: 'var(--hds-state-success-accent)' },
                  { dataKey: 'external', label: 'External', color: 'var(--hds-state-info-accent)' },
                  { dataKey: 'total', label: 'Total', color: 'var(--hds-color-slate-500)' },
                ]}
              />
            </Panel>
            <Panel title="Tren outcome" description="Status lifecycle per periode">
              <ChartFrame
                title=""
                data={result.data.trend.map((item) => ({
                  ...item,
                  bucket: trendLabel(item.bucketStart, query.granularity),
                }))}
                xKey="bucket"
                kind="line"
                series={[
                  {
                    dataKey: 'approved',
                    label: 'Approved',
                    color: 'var(--hds-state-success-accent)',
                  },
                  { dataKey: 'open', label: 'Open', color: 'var(--hds-state-warning-accent)' },
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
            </Panel>
            <RankingPanel rankings={result.data.rankings} />
          </div>
          <div className="tmmin-signal-grid">
            <Panel title="Ringkasan freshness" description="Kondisi data supplier saat ini">
              <FreshnessSummary
                summary={result.data.freshnessSummary}
                total={
                  result.data.freshnessSummary.fresh +
                  result.data.freshnessSummary.warning +
                  result.data.freshnessSummary.stale +
                  result.data.freshnessSummary.noData
                }
              />
            </Panel>
            <Panel title="Kesehatan ingesti" description="Aktivitas External authoritative">
              <div className="tmmin-health-list">
                <HealthRow
                  label="Accepted"
                  value={result.data.externalIngestion.accepted}
                  tone="success"
                />
                <HealthRow
                  label="Duplicate"
                  value={result.data.externalIngestion.duplicate}
                  tone="warning"
                />
                <HealthRow
                  label="Rejected"
                  value={result.data.externalIngestion.rejected}
                  tone="danger"
                />
              </div>
              <Link className="tmmin-panel-link" to="/external-health">
                Buka kesehatan External
              </Link>
            </Panel>
            <Panel title="Emergency override" description="Start Shift Hosted">
              <div className="tmmin-override-summary">
                <ShieldAlert aria-hidden="true" />
                <div>
                  <strong>{result.data.emergencyOverrides}</strong>
                  <span>override pada scope filter</span>
                </div>
              </div>
              {result.data.recentOverrides.slice(0, 2).map((override) => (
                <Link
                  key={override.shiftRunId}
                  className="tmmin-compact-link"
                  to={`/hosted-support/${override.supplierId}/shifts/${override.shiftRunId}`}
                >
                  <span>{override.supplierName}</span>
                  <small>{override.lineName}</small>
                </Link>
              ))}
            </Panel>
            <Panel title="Aktivitas External" description="Accepted dan rejected">
              <div className="tmmin-external-activity">
                <div>
                  <span>Accepted</span>
                  <strong>{result.data.externalIngestion.accepted}</strong>
                </div>
                <div>
                  <span>Rejected</span>
                  <strong>{result.data.externalIngestion.rejected}</strong>
                </div>
              </div>
              <Link className="tmmin-panel-link" to="/external-health">
                Lihat aktivitas External
              </Link>
            </Panel>
          </div>
          <Panel
            title="Ringkasan risiko supplier"
            description="Maksimal 10 supplier, diurutkan server berdasarkan Open Henkaten dan warning"
            action={
              <Link className="tmmin-panel-link" to="/suppliers">
                Lihat semua supplier
              </Link>
            }
          >
            {result.data.supplierOverview.length === 0 ? (
              <div className="tmmin-inline-empty">
                <Factory aria-hidden="true" />
                <div>
                  <strong>Belum ada supplier pada scope ini</strong>
                  <span>Ubah filter atau periksa status supplier.</span>
                </div>
              </div>
            ) : (
              <div className="tmmin-table-scroll">
                <table className="tmmin-table tmmin-risk-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Sumber</th>
                      <th>Open Henkaten</th>
                      <th>Warning</th>
                      <th>Aging &gt;24j</th>
                      <th>Freshness</th>
                      <th>Data terakhir</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.supplierOverview.map((row) => (
                      <tr key={row.supplierId}>
                        <td>
                          <strong>{row.supplierName}</strong>
                          <small>{row.supplierCode}</small>
                        </td>
                        <td>
                          <StatusBadge tone={row.sourceMode === 'HOSTED' ? 'success' : 'info'}>
                            {row.sourceMode}
                          </StatusBadge>
                        </td>
                        <td className="tmmin-number tmmin-emphasis">{row.openHenkatens}</td>
                        <td className="tmmin-number">{row.activeWarnings}</td>
                        <td className="tmmin-number">{row.over24HourWarnings}</td>
                        <td>
                          <StatusBadge tone={freshnessTone(row.freshness)}>
                            {freshnessLabel(row.freshness)}
                          </StatusBadge>
                        </td>
                        <td>{dateTime(row.lastDataAt)}</td>
                        <td>
                          <Link to={`/suppliers/${row.supplierId}`}>Lihat</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

export function WarningsPage() {
  const { session } = useTmminSession();
  const [params] = useSearchParams();
  const query = queryObject(params, ['supplierId', 'sourceMode', 'cursor']);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'warnings', query),
    queryFn: () => tmminApi.affectedParts(query),
  });
  return (
    <>
      <PageHeader
        eyebrow="Registry warning aktif"
        title="Peringatan Aktif"
        description="Affected part tetap terbuka sampai seluruh sumber Henkaten mencapai status terminal."
        actions={<UpdatedAt fetching={result.isFetching} retry={() => void result.refetch()} />}
      />
      {result.isLoading ? (
        <TableSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length === 0 ? (
        <QueryState empty="Tidak ada active warning pada scope ini." />
      ) : (
        <Panel
          title={`${result.data.items.length} affected part groups`}
          description="Warning tidak dapat ditutup manual."
        >
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Part</th>
                  <th>Warning tertua</th>
                  <th>Instance Open</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={`${row.supplierId}-${row.partNumber}`}>
                    <td>{row.supplierName}</td>
                    <td>
                      <strong>{row.partNumber}</strong>
                      <small>{row.partName}</small>
                    </td>
                    <td>{dateTime(row.oldestOpenedAt)}</td>
                    <td className="tmmin-number">{row.openWarningCount}</td>
                    <td>
                      <Link
                        to={`/warnings/${row.supplierId}/${encodeURIComponent(row.partNumber)}`}
                      >
                        Lihat detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

export function WarningDetailPage() {
  const { supplierId = '', partNumber = '' } = useParams();
  const { session } = useTmminSession();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'warning-detail', { supplierId, partNumber }),
    queryFn: () => tmminApi.affectedPart(supplierId, decodeURIComponent(partNumber)),
  });
  if (result.isLoading) return <TableSkeleton />;
  if (result.error || !result.data)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  return (
    <>
      <PageHeader
        eyebrow={result.data.supplierName}
        title={`${result.data.partNumber} · ${result.data.partName}`}
        description={`${result.data.openWarningCount} open source records contribute to this affected-part warning.`}
      />
      <Panel
        title="Record sumber"
        description="Lifecycle tetap authoritative pada Henkaten Hosted atau External."
      >
        <div className="tmmin-table-scroll">
          <table className="tmmin-table">
            <thead>
              <tr>
                <th>Sumber</th>
                <th>Record</th>
                <th>Status</th>
                <th>Dibuka</th>
              </tr>
            </thead>
            <tbody>
              {result.data.warnings.map((row) => (
                <tr key={row.id}>
                  <td>
                    <StatusBadge tone={row.sourceMode === 'HOSTED' ? 'info' : 'neutral'}>
                      {row.sourceMode}
                    </StatusBadge>
                  </td>
                  <td>
                    <Link
                      to={`/henkatens/${row.sourceMode.toLowerCase()}/${supplierId}/${row.henkatenId}`}
                    >
                      {row.henkatenId}
                    </Link>
                  </td>
                  <td>{row.status}</td>
                  <td>{dateTime(row.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function HenkatenExplorerPage() {
  const { session } = useTmminSession();
  const [params, setParams] = useSearchParams();
  const query = queryObject(params, [
    'supplierId',
    'sourceMode',
    'from',
    'to',
    'status',
    'category',
    'line',
    'part',
    'cursor',
  ]);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'henkatens', query),
    queryFn: () => tmminApi.henkatens({ ...query, limit: 25 }),
  });
  return (
    <>
      <PageHeader
        eyebrow="Penelusuran source-aware"
        title="Penelusuran Henkaten"
        description="Identitas Hosted dan snapshot External tetap terpisah dalam satu urutan stabil."
        actions={<UpdatedAt fetching={result.isFetching} retry={() => void result.refetch()} />}
      />
      <div className="tmmin-filter-strip">
        <NativeSelect
          aria-label="Status"
          value={params.get('status') ?? ''}
          onChange={(event) => updateParam(params, setParams, 'status', event.target.value)}
        >
          <option value="">Semua status</option>
          <option value="OPEN">Open</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Category"
          value={params.get('category') ?? ''}
          onChange={(event) => updateParam(params, setParams, 'category', event.target.value)}
        >
          <option value="">Semua 4M</option>
          <option value="MAN">Man</option>
          <option value="MACHINE">Machine</option>
          <option value="MATERIAL">Material</option>
          <option value="METHOD">Method</option>
        </NativeSelect>
      </div>
      {result.isLoading ? (
        <TableSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length === 0 ? (
        <QueryState />
      ) : (
        <Panel title="Record Henkaten" description="Hasil source-aware yang difilter server">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Supplier</th>
                  <th>Sumber</th>
                  <th>4M</th>
                  <th>Line / job</th>
                  <th>Part</th>
                  <th>Status</th>
                  <th>Terjadi</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={`${row.kind}-${row.recordId}`}>
                    <td>
                      <Link
                        to={`/henkatens/${row.kind.toLowerCase()}/${row.supplierId}/${row.recordId}`}
                      >
                        {row.displayId}
                      </Link>
                    </td>
                    <td>
                      {row.supplierCode}
                      <small>{row.supplierName}</small>
                    </td>
                    <td>
                      <StatusBadge tone={row.kind === 'HOSTED' ? 'info' : 'neutral'}>
                        {row.kind} · E{row.sourceEpoch}
                      </StatusBadge>
                    </td>
                    <td>{row.category}</td>
                    <td>
                      {row.lineName}
                      <small>{row.jobName}</small>
                    </td>
                    <td>
                      {row.partNumber}
                      <small>{row.partName}</small>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                    </td>
                    <td>{dateTime(row.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

export function HenkatenDetailPage() {
  const { kind = 'hosted', supplierId = '', recordId = '' } = useParams();
  const { session } = useTmminSession();
  const external = kind === 'external';
  const result = useQuery<unknown>({
    queryKey: tmminKey(session!.principal.userId, 'henkaten-detail', {
      kind,
      supplierId,
      recordId,
    }),
    queryFn: async () =>
      external
        ? await tmminApi.externalProjection(supplierId, recordId)
        : await tmminApi.hostedHenkaten(supplierId, recordId),
  });
  if (result.isLoading) return <TableSkeleton />;
  if (result.error || !result.data)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  const data = result.data as Record<string, unknown>;
  const line = labelOf(data.line);
  const part = labelOf(data.part, 'number');
  return (
    <>
      <PageHeader
        eyebrow={`${external ? 'External snapshot' : 'Hosted operational record'} · Epoch ${stringValue(data.sourceEpoch)}`}
        title={stringValue(data.sourceHenkatenId) || stringValue(data.identifier) || recordId}
        description="Field spesifik sumber ditampilkan tanpa menciptakan identitas lintas sumber."
      />
      <div className="tmmin-detail-layout">
        <div>
          <Panel
            title="Ringkasan konteks"
            description={
              external ? 'Immutable External snapshot boundary' : 'Hosted operational identity'
            }
          >
            <KeyValueGrid
              columns={3}
              items={[
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(String(data.status))}>
                      {String(data.status)}
                    </StatusBadge>
                  ),
                },
                { label: 'Category', value: String(data.category) },
                {
                  label: 'Source version',
                  value: external ? String(data.sourceVersion) : `v${String(data.version)}`,
                },
                { label: 'Line', value: line },
                { label: 'Part', value: part },
                { label: 'Occurred', value: dateTime(String(data.occurredAt)) },
              ]}
            />
          </Panel>
          <Panel
            title={external ? 'Change & checklist snapshot' : 'Hosted evidence'}
            description="Evidence hanya baca yang ditangkap oleh sumber authoritative."
          >
            <pre className="tmmin-json">
              {JSON.stringify(
                external
                  ? { change: data.change, checklist: data.checklist, decisions: data.decisions }
                  : { cause: data.cause, detail: data.detail, checklist: data.checklist },
                null,
                2,
              )}
            </pre>
          </Panel>
        </div>
        <aside>
          <Alert tone="info" title={external ? 'External lineage' : 'Hosted workflow'}>
            {external
              ? 'No Hosted-only user, shift, or assignment identity is inferred from this projection.'
              : 'This record remains traceable to Hosted shift and approval identities.'}
          </Alert>
          {external && Array.isArray(data.events) && (
            <Timeline
              items={(data.events as Array<Record<string, unknown>>).map((event) => ({
                title: String(event.eventType),
                description: `Version ${String(event.sourceVersion)}`,
                meta: dateTime(String(event.receivedAt)),
                tone: 'success',
              }))}
            />
          )}
        </aside>
      </div>
    </>
  );
}

export function ExternalHealthPage() {
  const { session } = useTmminSession();
  const [params] = useSearchParams();
  const query = queryObject(params, [
    'supplierId',
    'sourceEpoch',
    'outcome',
    'code',
    'from',
    'to',
    'lookup',
    'cursor',
  ]);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'external-health', query),
    queryFn: () => tmminApi.externalHealth({ ...query, limit: 25 }),
  });
  return (
    <>
      <PageHeader
        eyebrow="Diagnostik ingesti tersanitasi"
        title="Kesehatan Ingesti External"
        description="Freshness, client epoch, dan outcome ingesti tanpa mengekspos payload atau secret."
        actions={
          <UpdatedAt
            value={result.data?.generatedAt}
            fetching={result.isFetching}
            retry={() => void result.refetch()}
          />
        }
      />
      {result.isLoading ? (
        <DashboardSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <>
          <div className="tmmin-stat-grid">
            <StatCard
              label="Accepted"
              value={result.data.totals.accepted}
              icon={<Activity />}
              tone="success"
            />
            <StatCard label="Duplicate" value={result.data.totals.duplicate} icon={<RefreshCw />} />
            <StatCard
              label="Rejected"
              value={result.data.totals.rejected}
              icon={<ShieldAlert />}
              tone="danger"
            />
            <StatCard
              label="Stale / no data"
              value={result.data.totals.stale + result.data.totals.noData}
              icon={<Clock3 />}
              tone="warning"
            />
          </div>
          <Panel title="Freshness supplier" description="Client sumber External saat ini">
            <div className="tmmin-table-scroll">
              <table className="tmmin-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Epoch</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Ingesti sukses terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.suppliers.map((row) => (
                    <tr key={row.supplierId}>
                      <td>
                        {row.supplierCode}
                        <small>{row.supplierName}</small>
                      </td>
                      <td>E{row.sourceEpoch}</td>
                      <td>
                        {row.clientName ?? 'No client'}
                        <small>
                          {row.clientActive === null ? '' : row.clientActive ? 'Active' : 'Revoked'}
                        </small>
                      </td>
                      <td>
                        <StatusBadge tone={freshnessTone(row.freshness)}>
                          {row.freshness}
                        </StatusBadge>
                      </td>
                      <td>{dateTime(row.lastSuccessfulIngestionAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Aktivitas ingesti"
            description="Hanya field event dan correlation yang aman"
          >
            <div className="tmmin-table-scroll">
              <table className="tmmin-table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Supplier</th>
                    <th>Event</th>
                    <th>Kode aman</th>
                    <th>Correlation</th>
                    <th>Terjadi</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.events.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <StatusBadge
                          tone={
                            row.outcome === 'ACCEPTED'
                              ? 'success'
                              : row.outcome === 'REJECTED'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {row.outcome}
                        </StatusBadge>
                      </td>
                      <td>
                        {row.supplierName}
                        <small>E{row.sourceEpoch}</small>
                      </td>
                      <td>
                        {row.eventId ?? '—'}
                        <small>{row.sourceHenkatenId}</small>
                      </td>
                      <td>{row.code ?? '—'}</td>
                      <td>
                        <code>{row.correlationId}</code>
                      </td>
                      <td>{dateTime(row.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

export function AuditPage() {
  const { session } = useTmminSession();
  const [params] = useSearchParams();
  const query = queryObject(params, [
    'supplierId',
    'from',
    'to',
    'action',
    'resourceType',
    'resourceId',
    'cursor',
  ]);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'audit', query),
    queryFn: () => tmminApi.audit({ ...query, limit: 25 }),
  });
  const quality = session!.principal.role === 'TMMIN_QUALITY';
  return (
    <>
      <PageHeader
        eyebrow={quality ? 'Quality-safe allowlist' : 'Privileged administration trail'}
        title="Audit"
        description={
          quality
            ? 'Only operational monitoring events and sanitized External diagnostics are visible.'
            : 'Global administrative and operational evidence with role-scoped reasons.'
        }
        actions={<UpdatedAt fetching={result.isFetching} retry={() => void result.refetch()} />}
      />
      {result.isLoading ? (
        <TableSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <Panel title="Event audit" description="Akses ke timeline ini juga diaudit.">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Terjadi</th>
                  <th>Supplier</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Sumber</th>
                  <th>Result</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime(row.occurredAt)}</td>
                    <td>
                      {row.supplierCode ?? 'Global'}
                      <small>{row.supplierName}</small>
                    </td>
                    <td>
                      <strong>{row.action}</strong>
                      <small>{row.actorRole ?? row.actorKind}</small>
                    </td>
                    <td>
                      {row.resourceType}
                      <small>{row.resourceId}</small>
                    </td>
                    <td>{row.sourceMode ? `${row.sourceMode} · E${row.sourceEpoch}` : '—'}</td>
                    <td>
                      <StatusBadge tone={row.result === 'SUCCESS' ? 'success' : 'danger'}>
                        {row.result}
                      </StatusBadge>
                    </td>
                    <td>
                      <code>{row.correlationId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

export function NotificationsPage() {
  const { session } = useTmminSession();
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'notifications'),
    queryFn: () => tmminApi.notifications({ limit: 50 }),
  });
  const mutation = useMutation({
    mutationFn: ({ id, read, version }: { id: string; read: boolean; version: number }) =>
      tmminApi.setNotificationRead(id, read, version),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['TMMIN', session!.principal.userId] }),
  });
  return (
    <>
      <PageHeader
        eyebrow="Inbox berbasis role"
        title="Notifikasi"
        description="Warning External diterima Admin dan Quality; ingesti ditolak hanya untuk Admin."
      />
      {result.isLoading ? (
        <TableSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length === 0 ? (
        <QueryState empty="Tidak ada notifikasi." />
      ) : (
        <div className="tmmin-notifications">
          {result.data.items.map((item) => (
            <Card key={item.id} className={item.readAt ? '' : 'is-unread'}>
              <BellRing aria-hidden="true" />
              <div>
                <span>{item.kind}</span>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <small>{dateTime(item.createdAt)}</small>
              </div>
              <div>
                {item.deepLink && <Link to={item.deepLink}>Buka konteks</Link>}
                <Button
                  size="sm"
                  variant="ghost"
                  loading={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ id: item.id, read: !item.readAt, version: item.version })
                  }
                >
                  {item.readAt ? 'Mark unread' : 'Mark read'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function SystemStatusPage() {
  const { session } = useTmminSession();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'readiness'),
    queryFn: () => tmminApi.readiness(),
    staleTime: 0,
    retry: false,
  });
  return (
    <>
      <PageHeader
        eyebrow="Boundary browser bertipe"
        title="Status Sistem"
        description="Readiness membedakan kondisi sehat, belum siap, dan endpoint yang tidak dapat dijangkau."
        actions={
          <UpdatedAt
            value={result.data?.checkedAt}
            fetching={result.isFetching}
            retry={() => void result.refetch()}
          />
        }
      />
      {result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <div className="tmmin-detail-layout">
          <Panel title={result.data.service} description={`Release ${result.data.releaseSha}`}>
            <Alert
              tone={result.data.status === 'ready' ? 'success' : 'warning'}
              title={
                result.data.status === 'ready'
                  ? 'All readiness checks passed'
                  : 'Service is reachable but not ready'
              }
            >
              Last checked {dateTime(result.data.checkedAt)}
            </Alert>
            <div className="tmmin-checks">
              {result.data.checks.map((check) => (
                <div key={check.name}>
                  <span>{check.name}</span>
                  <StatusBadge tone={check.status === 'ready' ? 'success' : 'danger'}>
                    {check.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function DashboardFilters({
  params,
  suppliers,
  fallbackRange,
  onApply,
}: {
  params: URLSearchParams;
  suppliers: Array<{ id: string; code: string; name: string; sourceMode: string }>;
  fallbackRange: { from: string; to: string };
  onApply: (next: URLSearchParams) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of [
      'supplierId',
      'sourceMode',
      'status',
      'category',
      'line',
      'part',
      'aging',
      'freshness',
      'granularity',
    ]) {
      const value = formText(form, key).trim();
      if (value) next.set(key, value);
    }
    const from = formText(form, 'from');
    const to = formText(form, 'to');
    if (from) next.set('from', new Date(`${from}T00:00:00.000Z`).toISOString());
    if (to) next.set('to', new Date(`${to}T23:59:59.999Z`).toISOString());
    onApply(next);
  };
  return (
    <form className="tmmin-dashboard-filters" onSubmit={submit}>
      <div className="tmmin-dashboard-filters__grid">
        <label>
          <span>Supplier</span>
          <NativeSelect name="supplierId" defaultValue={params.get('supplierId') ?? ''}>
            <option value="">Semua supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Sumber</span>
          <NativeSelect name="sourceMode" defaultValue={params.get('sourceMode') ?? ''}>
            <option value="">Semua sumber</option>
            <option value="HOSTED">Hosted</option>
            <option value="EXTERNAL">External</option>
          </NativeSelect>
        </label>
        <label className="tmmin-date-field">
          <span>Dari tanggal</span>
          <input
            name="from"
            type="date"
            defaultValue={(params.get('from') ?? fallbackRange.from).slice(0, 10)}
          />
        </label>
        <label className="tmmin-date-field">
          <span>Sampai tanggal</span>
          <input
            name="to"
            type="date"
            defaultValue={(params.get('to') ?? fallbackRange.to).slice(0, 10)}
          />
        </label>
        <label>
          <span>Status</span>
          <NativeSelect name="status" defaultValue={params.get('status') ?? ''}>
            <option value="">Semua status</option>
            <option value="OPEN">Open</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </NativeSelect>
        </label>
        <label>
          <span>Kategori</span>
          <NativeSelect name="category" defaultValue={params.get('category') ?? ''}>
            <option value="">Semua 4M</option>
            <option value="MAN">Man</option>
            <option value="MACHINE">Machine</option>
            <option value="MATERIAL">Material</option>
            <option value="METHOD">Method</option>
          </NativeSelect>
        </label>
        <label>
          <span>Line</span>
          <input name="line" defaultValue={params.get('line') ?? ''} placeholder="Semua line" />
        </label>
        <label>
          <span>Part</span>
          <input name="part" defaultValue={params.get('part') ?? ''} placeholder="Nomor / nama" />
        </label>
        <label>
          <span>Aging</span>
          <NativeSelect name="aging" defaultValue={params.get('aging') ?? ''}>
            <option value="">Semua aging</option>
            <option value="UNDER_4_HOURS">&lt; 4 jam</option>
            <option value="FOUR_TO_EIGHT_HOURS">4–8 jam</option>
            <option value="EIGHT_TO_24_HOURS">8–24 jam</option>
            <option value="OVER_24_HOURS">&gt; 24 jam</option>
          </NativeSelect>
        </label>
        <label>
          <span>Freshness</span>
          <NativeSelect name="freshness" defaultValue={params.get('freshness') ?? ''}>
            <option value="">Semua freshness</option>
            <option value="FRESH">Fresh</option>
            <option value="WARNING">Perlu perhatian</option>
            <option value="STALE">Stale</option>
            <option value="NO_DATA">Tanpa data</option>
          </NativeSelect>
        </label>
        <label>
          <span>Interval</span>
          <NativeSelect name="granularity" defaultValue={params.get('granularity') ?? 'DAY'}>
            <option value="DAY">Harian</option>
            <option value="WEEK">Mingguan</option>
            <option value="MONTH">Bulanan</option>
          </NativeSelect>
        </label>
      </div>
      <div className="tmmin-dashboard-filters__actions">
        <button
          type="button"
          className="hds-button hds-button--ghost hds-button--sm"
          onClick={() => onApply(new URLSearchParams())}
        >
          Reset
        </button>
        <Button type="submit" size="sm">
          Terapkan
        </Button>
      </div>
    </form>
  );
}

function DashboardMetric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone: 'orange' | 'warning' | 'danger' | 'violet';
}) {
  return (
    <section className={`tmmin-dashboard-metric is-${tone}`}>
      <header>
        <span className="tmmin-dashboard-metric__icon">{icon}</span>
        <span>{label}</span>
      </header>
      <strong>{value.toLocaleString('id-ID')}</strong>
      <small>{detail}</small>
    </section>
  );
}

function SourceMetric({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'hosted' | 'external';
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`tmmin-source-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString('id-ID')}</strong>
      <small>{percent}%</small>
      <i>
        <b style={{ width: `${percent}%` }} />
      </i>
    </div>
  );
}

function RankingPanel({
  rankings,
}: {
  rankings: {
    suppliers: Array<{ label: string; count: number }>;
    lines: Array<{ label: string; count: number }>;
    parts: Array<{ label: string; count: number }>;
  };
}) {
  const [active, setActive] = useState<'suppliers' | 'lines' | 'parts'>('suppliers');
  const labels = { suppliers: 'Supplier', lines: 'Line', parts: 'Part' };
  return (
    <Panel title="Peringkat volume" description="Henkaten terbanyak pada scope filter">
      <div className="tmmin-rank-tabs" role="tablist" aria-label="Peringkat berdasarkan">
        {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <RankList items={rankings[active].slice(0, 5)} />
    </Panel>
  );
}

function FreshnessSummary({
  summary,
  total,
}: {
  summary: { fresh: number; warning: number; stale: number; noData: number };
  total: number;
}) {
  const rows = [
    ['Fresh', summary.fresh, 'success'],
    ['Perlu perhatian', summary.warning, 'warning'],
    ['Stale', summary.stale, 'danger'],
    ['Tanpa data', summary.noData, 'neutral'],
  ] as const;
  return (
    <div className="tmmin-freshness-summary">
      <div className="tmmin-freshness-summary__total">
        <strong>{total}</strong>
        <span>supplier</span>
      </div>
      <div>
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <i className={`is-${tone}`} />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{total ? Math.round((value / total) * 100) : 0}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger';
}) {
  return (
    <div>
      <i className={`is-${tone}`} />
      <span>{label}</span>
      <strong>{value.toLocaleString('id-ID')}</strong>
    </div>
  );
}

function UpdatedAt({
  value,
  fetching,
  retry,
}: {
  value?: string | undefined;
  fetching: boolean;
  retry: () => void;
}) {
  return (
    <div className="tmmin-updated">
      <span>
        {fetching ? 'Refreshing…' : value ? `Updated ${dateTime(value)}` : 'Refresh available'}
      </span>
      <Button size="sm" variant="ghost" onClick={retry} loading={fetching}>
        Refresh
      </Button>
    </div>
  );
}
function DashboardSkeleton() {
  return (
    <>
      <div className="tmmin-stat-grid">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="tmmin-stat-skeleton" />
        ))}
      </div>
      <div className="tmmin-dashboard-grid">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </>
  );
}
function TableSkeleton() {
  return (
    <Card className="tmmin-table-skeleton">
      {[1, 2, 3, 4, 5].map((item) => (
        <Skeleton key={item} />
      ))}
    </Card>
  );
}
function RankList({ items }: { items: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ol className="tmmin-rank">
      {items.map((item, index) => (
        <li key={item.label}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.label}</strong>
            <i style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <b>{item.count}</b>
        </li>
      ))}
    </ol>
  );
}
function queryObject(params: URLSearchParams, keys: string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (params.get(key) ? [[key, params.get(key)!]] : [])),
  );
}
function updateParam(
  params: URLSearchParams,
  setParams: (next: URLSearchParams) => void,
  key: string,
  value: string,
) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete('cursor');
  setParams(next);
}
function dateTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'No data';
}
function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  return status === 'APPROVED'
    ? 'success'
    : status === 'REJECTED'
      ? 'danger'
      : status === 'OPEN'
        ? 'warning'
        : 'neutral';
}
function freshnessTone(state: string): 'success' | 'danger' | 'warning' | 'neutral' {
  return state === 'FRESH'
    ? 'success'
    : state === 'STALE'
      ? 'danger'
      : state === 'WARNING'
        ? 'warning'
        : 'neutral';
}

function freshnessLabel(state: string) {
  if (state === 'FRESH') return 'Fresh';
  if (state === 'WARNING') return 'Perlu perhatian';
  if (state === 'STALE') return 'Stale';
  return 'Tanpa data';
}

function defaultDashboardRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString(), to: to.toISOString() };
}

function trendLabel(value: string, granularity?: string) {
  const date = new Date(value);
  if (granularity === 'MONTH')
    return date.toLocaleDateString('id-ID', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (granularity === 'WEEK')
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}
function labelOf(value: unknown, key = 'name') {
  if (!value || typeof value !== 'object') return '—';
  const record = value as Record<string, unknown>;
  for (const candidate of [record[key], record.name, record.code, record.externalId]) {
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return '—';
}
function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
