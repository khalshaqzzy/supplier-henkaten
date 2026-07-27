import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Alert, Card, KeyValueGrid, Panel, StatusBadge, Tabs } from '@tmmin-henkaten/ui';

import { tmminApi } from '../app/api';
import { tmminKey } from '../app/query';
import { useTmminSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { QueryState } from './StatePages';

export function HostedSupportPage() {
  const { session } = useTmminSession();
  const [params, setParams] = useSearchParams();
  const supplierId = params.get('supplierId') ?? '';
  const [tab, setTab] = useState('shifts');
  const suppliers = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-suppliers'),
    queryFn: () =>
      tmminApi.suppliers({ limit: 100, status: 'ACTIVE', sourceMode: 'HOSTED', sort: 'NAME_ASC' }),
  });
  const shifts = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-shifts', supplierId),
    queryFn: () => tmminApi.shifts(supplierId, { limit: 25 }),
    enabled: Boolean(supplierId && tab === 'shifts'),
  });
  const members = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-members', supplierId),
    queryFn: () => tmminApi.hostedMembers(supplierId, { limit: 100 }),
    enabled: Boolean(supplierId && tab === 'members'),
  });
  const lines = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-lines', supplierId),
    queryFn: () => tmminApi.hostedLines(supplierId, { limit: 100 }),
    enabled: Boolean(supplierId && tab === 'lines'),
  });
  const parts = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-parts', supplierId),
    queryFn: () => tmminApi.hostedParts(supplierId, { limit: 100 }),
    enabled: Boolean(supplierId && tab === 'parts'),
  });
  const templates = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'hosted-templates', supplierId),
    queryFn: () => tmminApi.hostedShiftTemplates(supplierId, { limit: 100 }),
    enabled: Boolean(supplierId && tab === 'templates'),
  });
  return (
    <>
      <PageHeader
        eyebrow="Dukungan Hosted hanya baca"
        title="Dukungan Hosted"
        description="Shift Hosted historis tetap dapat ditelusuri; Board aktif memerlukan sumber Hosted."
      />
      <div className="tmmin-filter-strip">
        <label>
          Konteks supplier
          <select
            value={supplierId}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('supplierId', event.target.value);
              else next.delete('supplierId');
              setParams(next);
            }}
          >
            <option value="">Pilih supplier Hosted</option>
            {suppliers.data?.items.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.name}
              </option>
            ))}
          </select>
        </label>
        {supplierId && (
          <Link
            className="hds-button hds-button--secondary hds-button--md"
            to={`/hosted-support/${supplierId}/board`}
          >
            Assignment Board
          </Link>
        )}
      </div>
      {!supplierId ? (
        <QueryState empty="Pilih supplier Hosted untuk membuka support read models." />
      ) : (
        <Tabs
          label="Hosted support areas"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: 'shifts',
              label: 'Shifts',
              content: (
                <ResourceTable
                  result={shifts}
                  columns={['status', 'line.name', 'shift.name', 'businessDate']}
                  link={(row) => `/hosted-support/${supplierId}/shifts/${String(row.id)}`}
                />
              ),
            },
            {
              value: 'members',
              label: 'Members',
              content: (
                <ResourceTable
                  result={members}
                  columns={['fullName', 'registrationNumber', 'role', 'active']}
                />
              ),
            },
            {
              value: 'lines',
              label: 'Lines',
              content: <ResourceTable result={lines} columns={['code', 'name', 'active']} />,
            },
            {
              value: 'parts',
              label: 'Parts',
              content: <ResourceTable result={parts} columns={['number', 'name', 'active']} />,
            },
            {
              value: 'templates',
              label: 'Shift templates',
              content: (
                <ResourceTable
                  result={templates}
                  columns={['name', 'startTime', 'endTime', 'active']}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}

export function AssignmentBoardPage() {
  const { supplierId = '' } = useParams();
  const { session } = useTmminSession();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'assignment-board', supplierId),
    queryFn: () => tmminApi.assignmentBoard(supplierId),
  });
  return (
    <>
      <PageHeader
        eyebrow="Sumber Hosted saat ini"
        title="Assignment Board"
        description="Assignment dan indikator Open Henkaten hanya baca untuk sumber Hosted."
      />
      {result.isLoading ? (
        <QueryState empty="Memuat Board…" />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.lines.length === 0 ? (
        <QueryState empty="No active Hosted shifts." />
      ) : (
        <div className="tmmin-board">
          {result.data.lines.map((line) => (
            <Panel
              key={line.shiftRunId}
              title={`${line.lineCode} · ${line.lineName}`}
              description={`${line.shiftName} · ${line.businessDate}`}
            >
              {line.activeOverride && (
                <Alert tone="warning" title="Shift dimulai dengan override">
                  {line.activeOverride.reason}
                </Alert>
              )}
              <div className="tmmin-board-grid">
                {line.jobs.map((job) => (
                  <Card key={job.assignmentId}>
                    <div>
                      <span>{job.displayOrder.toString().padStart(2, '0')}</span>
                      <StatusBadge tone={job.state === 'ASSIGNED' ? 'success' : 'warning'}>
                        {job.state}
                      </StatusBadge>
                    </div>
                    <h3>{job.jobName}</h3>
                    <p>
                      {job.mp.name ?? 'Vacant'}
                      <small>{job.mp.registrationNumber}</small>
                    </p>
                    <div>
                      {job.indicators.map((indicator) => (
                        <StatusBadge key={indicator.henkatenId} tone="warning">
                          {indicator.category} · {indicator.status}
                        </StatusBadge>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

export function ShiftDetailPage() {
  const { supplierId = '', shiftId = '' } = useParams();
  const { session } = useTmminSession();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'shift-detail', { supplierId, shiftId }),
    queryFn: () => tmminApi.shift(supplierId, shiftId),
  });
  if (result.isLoading) return <QueryState empty="Memuat evidence Shift…" />;
  if (result.error || !result.data)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  const data = result.data;
  return (
    <>
      <PageHeader
        eyebrow={`${data.line.code} · ${data.businessDate}`}
        title={data.shift.name}
        description="Detail Shift Hosted historis tetap tersedia setelah source cutover."
      />
      <Panel title="Evidence Shift" description="Snapshot sumber hanya baca">
        <KeyValueGrid
          columns={3}
          items={[
            { label: 'Status', value: data.status },
            { label: 'Epoch sumber', value: 'Snapshot Hosted' },
            { label: 'Supervisor', value: data.supervisor?.name ?? 'Unassigned' },
            { label: 'Line leader', value: data.lineLeader?.name ?? 'Unassigned' },
            { label: 'Scheduled start', value: dateTime(data.scheduledStartAt) },
            { label: 'Started', value: dateTime(data.startedAt) },
          ]}
        />
      </Panel>
    </>
  );
}

function ResourceTable({
  result,
  columns,
  link,
}: {
  result: { isLoading: boolean; error: unknown; data: unknown; refetch: () => unknown };
  columns: string[];
  link?: (row: Record<string, unknown>) => string;
}) {
  if (result.isLoading) return <QueryState empty="Memuat read model Hosted…" />;
  const data = result.data as { items?: Array<Record<string, unknown>> } | undefined;
  if (result.error || !data?.items)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  return (
    <Panel title={`${data.items.length} record`} description="Data sumber Hosted hanya baca">
      <div className="tmmin-table-scroll">
        <table className="tmmin-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{columnLabel(column)}</th>
              ))}
              {link && <th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((row, index) => (
              <tr key={safeCell(row.id, String(index))}>
                {columns.map((column) => (
                  <td key={column}>{resourceCell(row, column)}</td>
                ))}
                {link && (
                  <td>
                    <Link to={link(row)}>
                      View <ArrowRight />
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
export function resourceCell(row: Record<string, unknown>, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      row,
    );
  return safeCell(value);
}

function columnLabel(column: string) {
  if (column === 'line.name') return 'Line name';
  if (column === 'shift.name') return 'Shift template name';
  return humanize(column);
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
function dateTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'No data';
}
function safeCell(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}
