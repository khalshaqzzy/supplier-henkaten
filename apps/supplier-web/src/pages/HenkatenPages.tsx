import { ArrowRight, Check, Copy, ShieldCheck, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import type { HenkatenListQuery } from '@tmmin-henkaten/contracts';
import {
  Alert,
  AlertDialog,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  NativeSelect,
  Panel,
  Skeleton,
  Textarea,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { CursorPager } from '../components/CursorPager';
import { PageHeader } from '../components/layout';
import { FactItem, FactStrip } from '../components/OperationalUI';
import {
  ApprovalTimeline,
  ChangeEvidence,
  ManTransitionEvidence,
  ObjectTransitionEvidence,
} from './HenkatenWorkflow';

export function HenkatenListPage({ approvalQueue = false }: { approvalQueue?: boolean }) {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = scopeOf(session!);
  const cursor = params.get('cursor') ?? undefined;
  const query: HenkatenListQuery = {
    limit: 25,
    ...(cursor ? { cursor } : {}),
    ...(!approvalQueue && params.get('status')
      ? { status: params.get('status') as HenkatenListQuery['status'] }
      : {}),
    ...(params.get('category')
      ? { category: params.get('category') as HenkatenListQuery['category'] }
      : {}),
    ...(params.get('part') ? { part: params.get('part')! } : {}),
    ...(params.get('lineId') ? { lineId: params.get('lineId')! } : {}),
    ...(params.get('shiftRunId') ? { shiftRunId: params.get('shiftRunId')! } : {}),
    ...(params.get('from')
      ? { from: new Date(`${params.get('from')}T00:00:00.000Z`).toISOString() }
      : {}),
    ...(params.get('to')
      ? { to: new Date(`${params.get('to')}T23:59:59.999Z`).toISOString() }
      : {}),
    ...(params.get('approvalRoute')
      ? { approvalRoute: params.get('approvalRoute') as HenkatenListQuery['approvalRoute'] }
      : {}),
    ...(params.get('approvalStatus')
      ? { approvalStatus: params.get('approvalStatus') as HenkatenListQuery['approvalStatus'] }
      : {}),
    ...(!approvalQueue && params.get('pcr') === 'PCR' ? { pcrStatus: 'PCR' as const } : {}),
  };
  if (approvalQueue) {
    query.approvalRoute =
      (params.get('route') as HenkatenListQuery['approvalRoute']) ??
      (session!.principal.role === 'QC' ? 'QC' : 'SUPERVISOR');
    query.approvalStatus =
      (params.get('status') as HenkatenListQuery['approvalStatus']) ?? 'PENDING';
  }
  const list = useQuery({
    queryKey: scopedKey(scope, approvalQueue ? 'approval-queue' : 'henkatens', query),
    queryFn: () => supplierApi.henkatens(query),
  });
  const filterOptions = useQuery({
    queryKey: scopedKey(scope, 'henkaten-filter-options'),
    queryFn: () => supplierApi.dashboard({ granularity: 'DAY' }),
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    setParams(next, { replace: true });
  };
  return (
    <div className="product-page">
      <PageHeader
        eyebrow={approvalQueue ? 'Ruang keputusan' : 'Ketertelusuran 4M'}
        title={approvalQueue ? 'Antrean Approval' : 'Henkaten'}
        description=""
        actions={
          !approvalQueue && session!.principal.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/henkatens/new">
              Buat Henkaten
            </Link>
          ) : undefined
        }
      />
      {!approvalQueue && (
        <nav className="pcr-tabs" aria-label="Tampilan Henkaten">
          <Link className={params.get('pcr') !== 'PCR' ? 'is-current' : ''} to="/henkatens">
            Semua
          </Link>
          <Link className={params.get('pcr') === 'PCR' ? 'is-current' : ''} to="/henkatens?pcr=PCR">
            PCR
          </Link>
        </nav>
      )}
      <FilterBar>
        {approvalQueue && (
          <label>
            <span>Route</span>
            <NativeSelect
              value={params.get('route') ?? query.approvalRoute}
              onChange={(event) => update('route', event.target.value)}
            >
              {session!.principal.role !== 'QC' && <option value="SUPERVISOR">Supervisor</option>}
              {session!.principal.role === 'QC' && <option value="QC">QC</option>}
            </NativeSelect>
          </label>
        )}
        <label>
          <span>Status</span>
          <NativeSelect
            value={params.get('status') ?? (approvalQueue ? 'PENDING' : '')}
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="">{approvalQueue ? 'Semua route state' : 'Semua status'}</option>
            {(approvalQueue
              ? ['PENDING', 'APPROVED', 'REJECTED']
              : ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED']
            ).map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Kategori</span>
          <NativeSelect
            value={params.get('category') ?? ''}
            onChange={(event) => update('category', event.target.value)}
          >
            <option value="">Semua 4M</option>
            {['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Part</span>
          <Input
            value={params.get('part') ?? ''}
            placeholder="Nomor atau nama part"
            onChange={(event) => update('part', event.target.value)}
          />
        </label>
        <label>
          <span>Line</span>
          <NativeSelect
            value={params.get('lineId') ?? ''}
            onChange={(event) => update('lineId', event.target.value)}
          >
            <option value="">Semua line</option>
            {filterOptions.data?.filterOptions.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span>Dari</span>
          <Input
            type="date"
            value={params.get('from') ?? ''}
            onChange={(event) => update('from', event.target.value)}
          />
        </label>
        <label>
          <span>Sampai</span>
          <Input
            type="date"
            value={params.get('to') ?? ''}
            onChange={(event) => update('to', event.target.value)}
          />
        </label>
        {!approvalQueue && (
          <>
            <label>
              <span>Approval route</span>
              <NativeSelect
                value={params.get('approvalRoute') ?? ''}
                onChange={(event) => update('approvalRoute', event.target.value)}
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
                onChange={(event) => update('approvalStatus', event.target.value)}
              >
                <option value="">Semua approval</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="NOT_REQUIRED">Not Required</option>
              </NativeSelect>
            </label>
          </>
        )}
      </FilterBar>
      {list.isLoading && <HenkatenSkeleton />}
      {list.isError && (
        <ErrorState
          title={`${approvalQueue ? 'Antrean Approval' : 'Henkaten'} tidak dapat dimuat`}
          description="Coba refetch tanpa mengubah filter URL."
          action={<Button onClick={() => void list.refetch()}>Coba lagi</Button>}
        />
      )}
      {list.data?.items.length === 0 && (
        <EmptyState
          title={approvalQueue ? 'Tidak ada approval pending' : 'Belum ada Henkaten'}
          description=""
          action={
            params.size ? (
              <Button onClick={() => setParams({}, { replace: true })}>Reset filter</Button>
            ) : undefined
          }
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="data-table-wrap">
            <table className="data-table henkaten-table">
              <thead>
                <tr>
                  <th>Identifier</th>
                  <th>4M</th>
                  <th>Line / Job</th>
                  <th>Part</th>
                  <th>Business date</th>
                  <th>Supervisor</th>
                  <th>QC</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Identifier">
                      <strong>{item.identifier}</strong>
                      {item.pcr?.status === 'PCR' && <PcrBadge />}
                    </td>
                    <td data-label="4M">
                      <span className={`category-badge is-${item.category.toLowerCase()}`}>
                        {humanize(item.category)}
                      </span>
                    </td>
                    <td data-label="Line / Job">
                      {item.line.code} · {item.jobName}
                    </td>
                    <td data-label="Part">
                      <strong>{item.part.number}</strong>
                      <small>{item.part.name}</small>
                    </td>
                    <td data-label="Business date">
                      {item.businessDate}
                      <small>{formatDate(item.occurredAt, session!.supplier!.timezone)}</small>
                    </td>
                    <td data-label="Supervisor">
                      <RouteStatus value={item.routes.supervisor.status} />
                    </td>
                    <td data-label="QC">
                      <RouteStatus value={item.routes.qc.status} />
                    </td>
                    <td data-label="Status">
                      <span className={`status-label is-${item.status.toLowerCase()}`}>
                        {humanize(item.status)}
                      </span>
                    </td>
                    <td data-label="Aksi">
                      <Link to={`/henkatens/${item.id}`}>Buka</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CursorPager
            nextCursor={list.data.pageInfo.nextCursor}
            hasNextPage={list.data.pageInfo.hasNextPage}
            itemCount={list.data.items.length}
          />
        </>
      )}
    </div>
  );
}

export function HenkatenDetailPage() {
  const { henkatenId = '' } = useParams();
  const { session, hasCapability } = useSession();
  const queryClient = useQueryClient();
  const scope = scopeOf(session!);
  const [comment, setComment] = useState('');
  const [rerouteMemberId, setRerouteMemberId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [intentKey, setIntentKey] = useState(() => createIdempotencyKey());
  const record = useQuery({
    queryKey: scopedKey(scope, 'henkaten-detail', henkatenId),
    queryFn: () => supplierApi.henkaten(henkatenId),
  });
  const supervisors = useQuery({
    queryKey: scopedKey(scope, 'reroute-supervisors'),
    queryFn: () => supplierApi.members({ limit: 100, active: 'ACTIVE', search: undefined }),
    enabled: hasCapability('SUPPLIER_APPROVAL_REROUTE'),
  });
  const refresh = async () => {
    setProblem(null);
    await queryClient.invalidateQueries({
      queryKey: scopedKey(scope, 'henkaten-detail', henkatenId),
    });
    await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'henkatens') });
    await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'approval-queue') });
    setIntentKey(createIdempotencyKey());
    setComment('');
    setRerouteMemberId('');
  };
  const action = useMutation({
    mutationFn: async (kind: 'approve' | 'reject' | 'withdraw' | 'reroute') => {
      const current = record.data!;
      if (kind === 'reroute')
        return supplierApi.rerouteSupervisor(
          current.id,
          {
            expectedVersion: current.version,
            supervisorMemberId: rerouteMemberId,
          },
          intentKey,
        );
      if (kind === 'withdraw')
        return supplierApi.withdrawHenkaten(
          current.id,
          {
            expectedVersion: current.version,
            reason: comment || 'Ditarik oleh Line Leader setelah peninjauan.',
          },
          intentKey,
        );
      return supplierApi.decideHenkaten(
        current.id,
        {
          expectedVersion: current.version,
          decision: kind === 'approve' ? 'APPROVED' : 'REJECTED',
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
        intentKey,
      );
    },
    onSuccess: refresh,
    onError: (error) => {
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'State mungkin sudah berubah. Refresh record sebelum mengulangi action.',
      );
      setIntentKey(createIdempotencyKey());
    },
  });
  if (record.isLoading) return <HenkatenSkeleton />;
  if (record.isError || !record.data)
    return (
      <ErrorState
        title="Henkaten tidak dapat dimuat"
        description=""
        action={<Button onClick={() => void record.refetch()}>Coba lagi</Button>}
      />
    );
  const item = record.data;
  const role = session!.principal.role;
  const route = role === 'QC' ? item.routes.qc : item.routes.supervisor;
  const canDecide =
    hasCapability('SUPPLIER_HENKATEN_DECIDE') &&
    item.status === 'OPEN' &&
    route.status === 'PENDING';
  const canWithdraw = role === 'LINE_LEADER' && item.status === 'OPEN';
  const canReroute =
    hasCapability('SUPPLIER_APPROVAL_REROUTE') &&
    item.status === 'OPEN' &&
    item.routes.supervisor.status === 'PENDING';
  const canClone = role === 'LINE_LEADER';
  return (
    <div className="product-page henkaten-detail">
      <PageHeader
        eyebrow="Henkaten"
        title={item.identifier}
        description={`Dibuat ${formatDate(item.occurredAt, item.timezone)}`}
        status={
          <div className="henkaten-header-status">
            {item.pcr?.status === 'PCR' && <PcrBadge />}
            <span className={`status-label is-${item.status.toLowerCase()}`}>
              {humanize(item.status)}
            </span>
            <span className={`category-badge is-${item.category.toLowerCase()}`}>
              {humanize(item.category)}
            </span>
          </div>
        }
        meta={
          <div className="route-pills">
            <span>Supervisor</span>
            <RouteStatus value={item.routes.supervisor.status} />
            <span>QC</span>
            <RouteStatus value={item.routes.qc.status} />
          </div>
        }
        actions={
          <Link className="hds-button hds-button--secondary hds-button--md" to="/board">
            Kembali ke Board
          </Link>
        }
      />
      {problem && (
        <Alert tone="danger" title="Action tidak dapat diproses">
          {problem}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Refresh record
          </Button>
        </Alert>
      )}
      <FactStrip label="Konteks Henkaten">
        <FactItem label="Shift" value={item.shiftName} />
        <FactItem label="Business date" value={item.businessDate} />
        <FactItem label="Line" value={item.line.code} detail={item.line.name} />
        <FactItem label="Job" value={item.jobName} />
        <FactItem label="Part" value={item.part.number} detail={item.part.name} />
        <FactItem label="Dibuat oleh" value={item.creatorName} />
      </FactStrip>
      {item.pcr?.status === 'PCR' && item.pcr.assessment && (
        <section className="pcr-assessment" aria-labelledby="pcr-assessment-heading">
          <h2 id="pcr-assessment-heading">PCR assessment</h2>
          <p className="pcr-assessment__reason">{item.pcr.assessment}</p>
          <p className="pcr-assessment__action">
            Henkaten ini terindikasi memerlukan PCR. Ajukan PCR melalui jalur yang berlaku. Jika ada
            kendala teknis atau hasil penilaian tampak keliru, hubungi TMMIN QD.
          </p>
        </section>
      )}
      {item.pcr?.status === 'REVIEW' && (
        <div className="pcr-review-notice" role="status">
          Penilaian PCR perlu ditinjau oleh TMMIN QD.
        </div>
      )}
      <div className="henkaten-detail__layout">
        <div className="henkaten-detail__content">
          {(item.cancellationReason || item.withdrawalReason || item.clonedFromHenkatenId) && (
            <div className="record-traceability" aria-label="Traceability record">
              {item.cancellationReason && (
                <span>
                  <strong>Status terminal</strong>
                  {humanize(item.cancellationReason)}
                </span>
              )}
              {item.withdrawalReason && (
                <span>
                  <strong>Alasan Withdraw</strong>
                  {item.withdrawalReason}
                </span>
              )}
              {item.clonedFromHenkatenId && (
                <Link to={`/henkatens/${item.clonedFromHenkatenId}`}>
                  Dibuat dari Henkaten sebelumnya <ArrowRight />
                </Link>
              )}
            </div>
          )}
          <div className="henkaten-evidence-grid">
            <ChangeEvidence category={item.category} cause={item.cause} detail={item.detail} />
            {item.man ? (
              <ManTransitionEvidence
                replacedWasVacant={item.man.replacedWasVacant}
                replacedMpName={item.man.replacedMpName}
                replacementMpName={item.man.replacementMpName}
                movement={item.movement}
                formatDate={(value) => formatDate(value, item.timezone)}
              />
            ) : (
              <ObjectTransitionEvidence
                category={item.category}
                affected={item.affectedObject}
                replacement={item.replacementObject}
              />
            )}
          </div>
          <Panel title="Rute approval" description="" className="approval-timeline-panel">
            <ApprovalTimeline
              creatorName={item.creatorName}
              status={item.status}
              supervisor={item.routes.supervisor}
              qc={item.routes.qc}
              formatDate={(value) => formatDate(value, item.timezone)}
            />
          </Panel>
          <div className="detail-panels">
            <Panel title="Checklist snapshot" description={`Versi ${item.checklist.versionNumber}`}>
              <ol className="snapshot-list">
                {item.checklist.answers.map((answer) => (
                  <li key={answer.sourceItemId}>
                    <span>{answer.displayOrder}</span>
                    <strong>{answer.label}</strong>
                    <em>{answer.answer}</em>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="Riwayat" description="">
              <ol className="history-list">
                {item.history.map((transition) => (
                  <li key={transition.id}>
                    <span>
                      <Check />
                    </span>
                    <div>
                      <strong>{humanize(transition.toStatus)}</strong>
                      <p>
                        {transition.actorName} · {humanize(transition.actorRole)}
                      </p>
                      {transition.reason && (
                        <p className="history-list__reason">{transition.reason}</p>
                      )}
                      <small>{formatDate(transition.occurredAt, item.timezone)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </div>
        <aside className="detail-action-rail" aria-label="Tindakan Henkaten">
          <span className="product-eyebrow">Konteks tindakan</span>
          <h2>{canDecide ? `Keputusan ${routeLabel(route.route)}` : 'Tindakan record'}</h2>
          <div className="route-pills">
            <span>Supervisor</span>
            <RouteStatus value={item.routes.supervisor.status} />
            <span>QC</span>
            <RouteStatus value={item.routes.qc.status} />
          </div>
          {canDecide && (
            <div className="detail-action-group">
              <Field label="Catatan (opsional)" htmlFor="decision-comment">
                <Textarea
                  id="decision-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={2000}
                  placeholder="Tambahkan konteks untuk keputusan ini"
                />
              </Field>
              <AlertDialog
                title={`Approve route ${routeLabel(route.route)}?`}
                description=""
                confirmLabel="Konfirmasi Approve"
                onConfirm={() => action.mutate('approve')}
                trigger={
                  <Button
                    className="decision-approve-button"
                    leadingIcon={<Check />}
                    loading={action.isPending}
                  >
                    Approve
                  </Button>
                }
              />
              <AlertDialog
                title="Reject Henkaten?"
                description=""
                confirmLabel="Konfirmasi Reject"
                destructive
                onConfirm={() => action.mutate('reject')}
                trigger={
                  <Button variant="danger" leadingIcon={<XCircle />} loading={action.isPending}>
                    Reject
                  </Button>
                }
              />
            </div>
          )}
          {canReroute && (
            <div className="detail-action-group">
              <Field label="Reroute Supervisor" htmlFor="reroute-supervisor">
                <NativeSelect
                  id="reroute-supervisor"
                  value={rerouteMemberId}
                  onChange={(event) => setRerouteMemberId(event.target.value)}
                >
                  <option value="">Pilih Supervisor aktif</option>
                  {supervisors.data?.items
                    .filter(
                      (member) =>
                        member.role === 'SUPERVISOR' &&
                        member.id !== item.routes.supervisor.currentResponsibleMemberId,
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName} · {member.registrationNumber}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <AlertDialog
                title="Reroute Supervisor?"
                description=""
                confirmLabel="Konfirmasi Reroute"
                onConfirm={() => action.mutate('reroute')}
                trigger={
                  <Button
                    variant="secondary"
                    disabled={!rerouteMemberId}
                    loading={action.isPending}
                  >
                    Reroute Supervisor
                  </Button>
                }
              />
            </div>
          )}
          {canClone && (
            <Link
              className="hds-button hds-button--secondary hds-button--md"
              to={`/henkatens/${item.id}/clone`}
            >
              <Copy />
              Clone Henkaten
            </Link>
          )}
          {canWithdraw && (
            <div className="detail-action-group">
              <Field label="Alasan Withdraw" htmlFor="withdraw-reason">
                <Textarea
                  id="withdraw-reason"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={1000}
                />
              </Field>
              <AlertDialog
                title="Withdraw Henkaten Open?"
                description=""
                confirmLabel="Konfirmasi Withdraw"
                destructive
                onConfirm={() => action.mutate('withdraw')}
                trigger={
                  <Button variant="danger" disabled={!comment.trim()} loading={action.isPending}>
                    Withdraw
                  </Button>
                }
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function RouteStatus({ value }: { value: string }) {
  return (
    <span className={`route-status is-${value.toLowerCase()}`}>
      {value === 'APPROVED' ? <Check /> : value === 'REJECTED' ? <XCircle /> : <ShieldCheck />}
      {humanize(value)}
    </span>
  );
}
function PcrBadge() {
  return <span className="pcr-badge">PCR</span>;
}
function HenkatenSkeleton() {
  return (
    <div className="list-skeleton">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}
function scopeOf(session: NonNullable<ReturnType<typeof useSession>['session']>) {
  return {
    userId: session.principal.userId,
    supplierId: session.supplier!.id,
    purpose: session.principal.purpose,
  };
}
function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}

function routeLabel(value: string) {
  return value === 'QC' ? 'QC' : humanize(value);
}
