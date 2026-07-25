import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BellRing,
  Boxes,
  Clock3,
  Factory,
  RefreshCw,
  ShieldAlert,
  Siren,
} from 'lucide-react';
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
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'dashboard', query),
    queryFn: () =>
      tmminApi.dashboard({ ...query, granularity: query.granularity ?? 'DAY' } as never),
  });
  return (
    <>
      <PageHeader
        eyebrow="Cross-supplier monitoring"
        title="Global Overview"
        description="Satu read model untuk Henkaten Hosted, proyeksi External, warning, override, dan freshness."
        actions={
          <UpdatedAt
            value={result.data?.generatedAt}
            fetching={result.isFetching}
            retry={() => void result.refetch()}
          />
        }
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
          aria-label="Kategori 4M"
          value={params.get('category') ?? ''}
          onChange={(event) => updateParam(params, setParams, 'category', event.target.value)}
        >
          <option value="">Semua 4M</option>
          <option value="MAN">Man</option>
          <option value="MACHINE">Machine</option>
          <option value="MATERIAL">Material</option>
          <option value="METHOD">Method</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Aging"
          value={params.get('aging') ?? ''}
          onChange={(event) => updateParam(params, setParams, 'aging', event.target.value)}
        >
          <option value="">Semua aging</option>
          <option value="UNDER_4_HOURS">&lt; 4 jam</option>
          <option value="FOUR_TO_EIGHT_HOURS">4–8 jam</option>
          <option value="EIGHT_TO_24_HOURS">8–24 jam</option>
          <option value="OVER_24_HOURS">&gt; 24 jam</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Freshness"
          value={params.get('freshness') ?? ''}
          onChange={(event) => updateParam(params, setParams, 'freshness', event.target.value)}
        >
          <option value="">Semua freshness</option>
          <option value="FRESH">Fresh</option>
          <option value="WARNING">Warning</option>
          <option value="STALE">Stale</option>
          <option value="NO_DATA">No data</option>
        </NativeSelect>
      </div>
      {result.isLoading ? (
        <DashboardSkeleton />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <>
          <div className="tmmin-stat-grid">
            <StatCard
              label="Active suppliers"
              value={result.data.suppliers.active}
              detail={`${result.data.suppliers.hosted} Hosted · ${result.data.suppliers.external} External`}
              icon={<Factory />}
            />
            <StatCard
              label="Open Henkaten"
              value={result.data.openHenkatens}
              detail={`${result.data.affectedParts} affected parts`}
              icon={<Boxes />}
              tone="warning"
            />
            <StatCard
              label="Active warnings"
              value={result.data.suppliers.withWarnings}
              detail="Supplier membutuhkan perhatian"
              icon={<Siren />}
              tone="danger"
            />
            <StatCard
              label="Emergency overrides"
              value={result.data.emergencyOverrides}
              detail="Hosted shift starts"
              icon={<ShieldAlert />}
            />
          </div>
          <div className="tmmin-dashboard-grid">
            <Panel title="Henkaten by 4M" description="Hosted + External filtered total">
              <ChartFrame
                title=""
                data={result.data.byCategory}
                xKey="label"
                kind="bar"
                series={[{ dataKey: 'count', label: 'Henkaten', color: 'var(--hds-brand-accent)' }]}
              />
            </Panel>
            <Panel title="Outcome distribution" description="Terminal Henkaten status">
              <ChartFrame
                title=""
                data={result.data.outcomes}
                xKey="label"
                kind="bar"
                series={[
                  { dataKey: 'count', label: 'Records', color: 'var(--hds-color-blue-600)' },
                ]}
              />
            </Panel>
            <Panel title="Warning aging" description="Open warning exposure">
              <div className="tmmin-aging">
                {result.data.aging.map((item) => (
                  <div key={item.bucket}>
                    <span>{agingLabel(item.bucket)}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="External ingestion" description="Authoritative activity counters">
              <div className="tmmin-ingestion-stats">
                <div>
                  <strong>{result.data.externalIngestion.accepted}</strong>
                  <span>Accepted</span>
                </div>
                <div>
                  <strong>{result.data.externalIngestion.duplicate}</strong>
                  <span>Duplicate</span>
                </div>
                <div>
                  <strong>{result.data.externalIngestion.rejected}</strong>
                  <span>Rejected</span>
                </div>
              </div>
            </Panel>
          </div>
          <div className="tmmin-wide-grid">
            <Panel title="Supplier ranking" description="Highest filtered Henkaten volume">
              <RankList items={result.data.rankings.suppliers} />
            </Panel>
            <Panel title="Data freshness" description="Source-specific last data time">
              <div className="tmmin-table-scroll">
                <table className="tmmin-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Source</th>
                      <th>State</th>
                      <th>Last data</th>
                      <th>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.freshness.map((row) => (
                      <tr key={row.supplierId}>
                        <td>
                          <Link to={`/suppliers/${row.supplierId}`}>
                            {row.supplierCode} · {row.supplierName}
                          </Link>
                        </td>
                        <td>{row.sourceMode}</td>
                        <td>
                          <StatusBadge tone={freshnessTone(row.state)}>{row.state}</StatusBadge>
                        </td>
                        <td>{dateTime(row.lastDataAt)}</td>
                        <td className="tmmin-number">{row.activeWarnings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
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
        eyebrow="Active warning registry"
        title="Active Warnings"
        description="Affected part groups remain open until their source Henkaten reaches a terminal state."
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
                  <th>Oldest warning</th>
                  <th>Open instances</th>
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
                        View details
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
        title="Source records"
        description="Lifecycle remains authoritative in Hosted or External Henkaten."
      >
        <div className="tmmin-table-scroll">
          <table className="tmmin-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Record</th>
                <th>Status</th>
                <th>Opened</th>
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
        eyebrow="Unified source-aware explorer"
        title="Global Henkaten Explorer"
        description="Hosted identity and External snapshots remain visibly distinct while sharing one stable ordering."
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
        <Panel title="Henkaten records" description="Server-filtered, source-aware results">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Supplier</th>
                  <th>Source</th>
                  <th>4M</th>
                  <th>Line / job</th>
                  <th>Part</th>
                  <th>Status</th>
                  <th>Occurred</th>
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
        description="Source-specific fields are presented without inventing cross-source identity."
      />
      <div className="tmmin-detail-layout">
        <div>
          <Panel
            title="Context summary"
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
            description="Read-only evidence captured by the authoritative source."
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
        eyebrow="Sanitized ingestion diagnostics"
        title="External Ingestion Health"
        description="Freshness, client epoch, and accepted/duplicate/rejected attempts without raw payload or secret exposure."
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
          <Panel title="Supplier freshness" description="Current External source clients">
            <div className="tmmin-table-scroll">
              <table className="tmmin-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Epoch</th>
                    <th>Client</th>
                    <th>State</th>
                    <th>Last successful ingestion</th>
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
            title="Ingestion activity"
            description="Safe event and correlation lookup fields only"
          >
            <div className="tmmin-table-scroll">
              <table className="tmmin-table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Supplier</th>
                    <th>Event</th>
                    <th>Safe code</th>
                    <th>Correlation</th>
                    <th>Occurred</th>
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
        <Panel title="Audit events" description="Viewing this timeline is itself audited.">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Occurred</th>
                  <th>Supplier</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Source</th>
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
        eyebrow="Role-aware inbox"
        title="Notifications"
        description="External warnings reach Admin and Quality; rejected ingestion alerts remain Admin-only."
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
                {item.deepLink && <Link to={item.deepLink}>Open context</Link>}
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
        eyebrow="Typed browser boundary"
        title="System Status"
        description="Readiness accepts healthy and schema-valid 503 not_ready responses; unreachable state remains distinct."
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
function agingLabel(value: string) {
  return (
    (
      {
        UNDER_4_HOURS: '< 4 hours',
        FOUR_TO_EIGHT_HOURS: '4–8 hours',
        EIGHT_TO_24_HOURS: '8–24 hours',
        OVER_24_HOURS: '> 24 hours',
      } as Record<string, string>
    )[value] ?? value
  );
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
