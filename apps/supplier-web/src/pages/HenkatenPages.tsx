import { ArrowRight, Check, ClipboardCheck, Copy, ShieldCheck, XCircle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import type {
  CreateHenkatenRequest,
  HenkatenCategory,
  HenkatenListQuery,
} from '@tmmin-henkaten/contracts';
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
  ChecklistResponseList,
  HenkatenCategoryPicker,
  ManMovementPreview,
  ManTransitionEvidence,
  ObjectTransitionEvidence,
  ReadinessList,
  SelectedPart,
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
  const shiftOptions = useQuery({
    queryKey: scopedKey(scope, 'henkaten-shift-options'),
    queryFn: () => supplierApi.shifts({ limit: 100 }),
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
        description={
          approvalQueue
            ? 'Selesaikan rute approval yang menjadi tanggung jawab Anda; reject pertama bersifat terminal.'
            : 'Telusuri perubahan 4M current dan terminal dengan filter server-side.'
        }
        actions={
          !approvalQueue && session!.principal.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/henkatens/new">
              Buat Henkaten
            </Link>
          ) : undefined
        }
      />
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
          <span>Shift</span>
          <NativeSelect
            value={params.get('shiftRunId') ?? ''}
            onChange={(event) => update('shiftRunId', event.target.value)}
          >
            <option value="">Semua shift</option>
            {shiftOptions.data?.items.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.line.code} · {shift.shift.name} · {shift.businessDate}
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
          description={
            approvalQueue
              ? 'Queue akan terisi ketika route responsibility Anda pending.'
              : 'Henkaten dibuat Line Leader pada Shift Run aktif atau planned.'
          }
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
                      <small>
                        {item.sourceMode} · epoch {item.sourceEpoch}
                      </small>
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

export function HenkatenCreatePage({ clone = false }: { clone?: boolean }) {
  const { henkatenId } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scope = scopeOf(session!);
  const [category, setCategory] = useState<HenkatenCategory>('MAN');
  const [shiftId, setShiftId] = useState(params.get('shiftRunId') ?? '');
  const [jobId, setJobId] = useState(params.get('jobId') ?? '');
  const [partId, setPartId] = useState('');
  const [partSearch, setPartSearch] = useState('');
  const [targetAssignmentId, setTargetAssignmentId] = useState('');
  const [replacementMpId, setReplacementMpId] = useState('');
  const [cause, setCause] = useState('');
  const [detail, setDetail] = useState('');
  const [affectedObject, setAffectedObject] = useState('');
  const [replacementObject, setReplacementObject] = useState('');
  const [answers, setAnswers] = useState<Record<string, 'YES' | 'NO'>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [intentKey, setIntentKey] = useState(() => createIdempotencyKey());
  const clonePrefill = useQuery({
    queryKey: scopedKey(scope, 'henkaten-clone-prefill', henkatenId),
    queryFn: () => supplierApi.clonePrefill(henkatenId!),
    enabled: clone && Boolean(henkatenId),
  });
  const current = useQuery({
    queryKey: scopedKey(scope, 'current-shift-create', shiftId),
    queryFn: () => (shiftId ? supplierApi.shift(shiftId) : supplierApi.currentShift()),
  });
  const effectiveShiftId = shiftId || current.data?.id || '';
  const working = useQuery({
    queryKey: scopedKey(scope, 'working-assignments-create', effectiveShiftId),
    queryFn: () => supplierApi.workingAssignments(effectiveShiftId),
    enabled: Boolean(effectiveShiftId),
  });
  const formOptions = useQuery({
    queryKey: scopedKey(scope, 'henkaten-form-options', { category, partSearch }),
    queryFn: () =>
      supplierApi.henkatenFormOptions({
        category,
        ...(partSearch.trim() ? { part: partSearch.trim() } : {}),
      }),
  });
  const checklist = formOptions.data?.checklist ?? undefined;
  useEffect(() => {
    const prefill = clonePrefill.data;
    if (!prefill) return;
    setCategory(prefill.category);
    setShiftId(prefill.shiftStillValid ? prefill.shiftRunId : '');
    setJobId(prefill.jobStillValid ? prefill.jobId : '');
    setPartId(prefill.partStillValid ? prefill.partId : '');
    setCause(prefill.cause);
    setDetail(prefill.detail);
    setAffectedObject(prefill.affectedObject ?? '');
    setReplacementObject(prefill.replacementObject ?? '');
    setAnswers({});
  }, [clonePrefill.data]);
  useEffect(() => {
    setAnswers({});
    setReplacementMpId('');
  }, [category]);
  useEffect(() => {
    if (targetAssignmentId || !jobId || !working.data) return;
    setTargetAssignmentId(working.data.find((item) => item.jobId === jobId)?.id ?? '');
  }, [jobId, targetAssignmentId, working.data]);
  const target = working.data?.find((assignment) => assignment.id === targetAssignmentId);
  const replacement = formOptions.data?.replacementMembers.find(
    (member) => member.id === replacementMpId,
  );
  const selectedPart = formOptions.data?.parts.find((part) => part.id === partId);
  const checklistComplete =
    Boolean(checklist?.items.length) &&
    checklist!.items.every((item) => answers[item.id] === 'YES');
  const yesCount = checklist?.items.filter((item) => answers[item.id] === 'YES').length ?? 0;
  const noCount = checklist?.items.filter((item) => answers[item.id] === 'NO').length ?? 0;
  const unansweredCount = Math.max((checklist?.items.length ?? 0) - yesCount - noCount, 0);
  const operationalComplete = Boolean(effectiveShiftId && jobId && partId);
  const categoryDetailComplete =
    category === 'MAN'
      ? Boolean(target && replacement && !replacement.reserved)
      : Boolean(affectedObject.trim() && replacementObject.trim());
  const narrativeComplete = Boolean(cause.trim() && detail.trim());
  const valid =
    operationalComplete && categoryDetailComplete && narrativeComplete && checklistComplete;
  const readinessItems = [
    {
      label: 'Konteks operasional',
      complete: operationalComplete,
      detail: operationalComplete ? 'Shift, job, dan part dipilih' : 'Lengkapi job dan part',
    },
    {
      label: category === 'MAN' ? 'Pergerakan Man' : 'Transisi objek',
      complete: categoryDetailComplete,
      detail: categoryDetailComplete
        ? 'Detail kategori lengkap'
        : category === 'MAN'
          ? 'Pilih target dan replacement'
          : 'Lengkapi kondisi sebelum dan sesudah',
    },
    {
      label: 'Penyebab & detail',
      complete: narrativeComplete,
      detail: narrativeComplete ? 'Narasi perubahan lengkap' : 'Lengkapi kedua field narasi',
    },
    {
      label: 'Checklist',
      complete: checklistComplete,
      detail: checklistComplete
        ? `${yesCount}/${checklist?.items.length ?? 0} item memenuhi`
        : noCount
          ? `${noCount} jawaban No perlu ditinjau`
          : `${unansweredCount} item belum dijawab`,
    },
  ];
  const submit = useMutation({
    mutationFn: () => {
      const base = {
        shiftRunId: effectiveShiftId,
        jobId,
        partId,
        checklistVersionId: checklist!.id,
        checklistAnswers: checklist!.items.map((item) => ({
          itemId: item.id,
          answer: answers[item.id]!,
        })),
        cause,
        detail,
        ...(clone && henkatenId ? { clonedFromHenkatenId: henkatenId } : {}),
      };
      const payload: CreateHenkatenRequest =
        category === 'MAN'
          ? {
              ...base,
              category,
              targetWorkingAssignmentId: target!.id,
              targetAssignmentVersion: target!.version,
              replaced: target!.effectiveMpMemberId
                ? { kind: 'MP', memberId: target!.effectiveMpMemberId }
                : { kind: 'VACANT' },
              replacementMpMemberId: replacementMpId,
              ...(replacement?.currentAssignment
                ? {
                    sourceWorkingAssignmentId: replacement.currentAssignment.id,
                    sourceAssignmentVersion: replacement.currentAssignment.version,
                  }
                : {}),
              ...(params.get('resolutionIssueId')
                ? { resolutionIssueId: params.get('resolutionIssueId')! }
                : {}),
            }
          : { ...base, category, affectedObject, replacementObject };
      return supplierApi.createHenkaten(payload, intentKey);
    },
    onSuccess: (created) => navigate(`/henkatens/${created.id}`, { replace: true }),
    onError: (error) => {
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Submission belum dapat dipastikan. Refresh sebelum mencoba kembali.',
      );
      setIntentKey(createIdempotencyKey());
      void working.refetch();
    },
  });
  const send = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (valid) submit.mutate();
  };
  return (
    <div className="product-page create-henkaten-page">
      <PageHeader
        eyebrow={clone ? 'Koreksi sebagai record baru' : 'Submission 4M'}
        title={clone ? 'Clone Henkaten' : 'Buat Henkaten'}
        description="Satu submission immutable untuk Shift Run dan versi checklist saat ini."
      />
      {!current.data && !current.isLoading && (
        <Alert tone="danger" title="Tidak ada active atau planned shift">
          Buka Shift dan jalankan preflight sebelum membuat Henkaten.
        </Alert>
      )}
      {problem && (
        <Alert tone="danger" title="Submission gagal">
          {problem}
        </Alert>
      )}
      {current.data && (
        <FactStrip label="Konteks Shift untuk Henkaten">
          <FactItem label="Line" value={current.data.line.code} detail={current.data.line.name} />
          <FactItem label="Shift Run" value={current.data.shift.name} />
          <FactItem label="Business date" value={current.data.businessDate} />
          <FactItem label="Status Shift" value={humanize(current.data.status)} />
          <FactItem label="Timezone" value={current.data.timezone} />
        </FactStrip>
      )}
      <form onSubmit={send} className="henkaten-form">
        <div className="henkaten-form__main">
          <Panel
            title="1. Kategori Henkaten"
            description="Pilih satu kategori 4M. Checklist akan dimuat ulang."
            className="henkaten-workspace-section henkaten-category-section"
          >
            <HenkatenCategoryPicker value={category} onChange={setCategory} />
          </Panel>
          <div className="henkaten-operational-grid">
            <Panel
              title="2. Konteks target"
              description="Tetapkan job dan part pada Shift Run yang terkunci."
              className="henkaten-workspace-section target-operational-panel"
            >
              <div
                className="operational-context-lock"
                role="status"
                aria-label="Shift Run read-only"
              >
                <span className="operational-context-lock__icon">
                  <ShieldCheck aria-hidden="true" />
                </span>
                <span>
                  <small>Shift Run · read-only</small>
                  <strong>
                    {current.data
                      ? `${current.data.shift.name} · ${current.data.businessDate}`
                      : effectiveShiftId || 'Belum tersedia'}
                  </strong>
                  <em>
                    {current.data
                      ? `${current.data.line.code} · ${current.data.line.name}`
                      : 'Menunggu konteks aktif'}
                  </em>
                </span>
                <span
                  className={`operational-context-lock__state${
                    current.data ? ' is-ready' : ' is-unavailable'
                  }`}
                >
                  {current.data ? humanize(current.data.status) : 'Unavailable'}
                </span>
              </div>
              <Field label="Target job" htmlFor="job" required>
                <NativeSelect
                  id="job"
                  value={jobId}
                  disabled={working.isLoading || !effectiveShiftId}
                  onChange={(event) => {
                    setJobId(event.target.value);
                    setTargetAssignmentId(
                      working.data?.find((item) => item.jobId === event.target.value)?.id ?? '',
                    );
                  }}
                >
                  <option value="">{working.isLoading ? 'Memuat job...' : 'Pilih job'}</option>
                  {working.data?.map((assignment) => (
                    <option key={assignment.id} value={assignment.jobId}>
                      {assignment.jobName} · {assignment.mpName ?? 'VACANT'}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Cari part" htmlFor="part-search">
                <Input
                  id="part-search"
                  value={partSearch}
                  placeholder="Cari nomor atau nama part"
                  disabled={formOptions.isLoading}
                  onChange={(event) => {
                    setPartSearch(event.target.value);
                    setPartId('');
                  }}
                />
              </Field>
              <Field label="Part terdampak" htmlFor="part" required>
                <NativeSelect
                  id="part"
                  value={partId}
                  disabled={formOptions.isLoading}
                  onChange={(event) => setPartId(event.target.value)}
                >
                  <option value="">
                    {formOptions.isLoading
                      ? 'Memuat part...'
                      : formOptions.data?.parts.length === 0
                        ? 'Tidak ada part aktif'
                        : 'Pilih part'}
                  </option>
                  {formOptions.data?.parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.partNumber} · {part.partName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <SelectedPart part={selectedPart} onClear={() => setPartId('')} />
            </Panel>
            {category === 'MAN' ? (
              <Panel
                title="3. Komposisi pergerakan Man"
                description="Review assignment asal dan tujuan sebelum melengkapi submission."
                className="henkaten-workspace-section man-movement-panel"
              >
                <div className="movement-selectors">
                  <Field label="Target assignment" htmlFor="targetAssignment" required>
                    <NativeSelect
                      id="targetAssignment"
                      value={targetAssignmentId}
                      disabled={working.isLoading}
                      onChange={(event) => {
                        setTargetAssignmentId(event.target.value);
                        setJobId(
                          working.data?.find((item) => item.id === event.target.value)?.jobId ?? '',
                        );
                      }}
                    >
                      <option value="">
                        {working.isLoading ? 'Memuat assignment...' : 'Pilih assignment'}
                      </option>
                      {working.data?.map((assignment) => (
                        <option key={assignment.id} value={assignment.id}>
                          {assignment.jobName} · {assignment.mpName ?? 'VACANT'}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Replacement MP" htmlFor="replacement" required>
                    <NativeSelect
                      id="replacement"
                      value={replacementMpId}
                      disabled={formOptions.isLoading}
                      onChange={(event) => setReplacementMpId(event.target.value)}
                    >
                      <option value="">
                        {formOptions.isLoading ? 'Memuat kandidat...' : 'Pilih MP'}
                      </option>
                      {formOptions.data?.replacementMembers
                        .filter((member) => member.id !== target?.effectiveMpMemberId)
                        .map((member) => (
                          <option key={member.id} value={member.id} disabled={member.reserved}>
                            {member.fullName} · {member.registrationNumber}
                            {member.reserved
                              ? ' · Reserved'
                              : member.currentAssignment
                                ? ` · ${member.currentAssignment.lineName}/${member.currentAssignment.jobName}`
                                : ' · Tersedia'}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                </div>
                <ManMovementPreview
                  target={target}
                  replacement={replacement}
                  targetLine={current.data?.line.name}
                />
                {replacement?.currentAssignment && (
                  <Alert tone="info" title="Replacement berasal dari assignment aktif">
                    Atomic movement akan memindahkan {replacement.fullName} dari{' '}
                    {replacement.currentAssignment.lineName}/{replacement.currentAssignment.jobName}
                    ; assignment sumber dapat menjadi vacant dan memerlukan resolution berikutnya.
                  </Alert>
                )}
              </Panel>
            ) : (
              <Panel
                title="3. Komposisi perubahan objek"
                description="Review kondisi sebelum dan sesudah secara berdampingan."
                className="henkaten-workspace-section object-change-panel"
              >
                <div className={`object-change-inputs is-${category.toLowerCase()}`}>
                  <Field
                    label="Objek terdampak"
                    htmlFor="affected"
                    helperText={`${affectedObject.length}/2000 karakter`}
                    required
                  >
                    <Textarea
                      id="affected"
                      value={affectedObject}
                      onChange={(event) => setAffectedObject(event.target.value)}
                      maxLength={2000}
                      placeholder="Kondisi atau objek sebelum perubahan"
                    />
                  </Field>
                  <span className="object-change-inputs__arrow" aria-hidden="true">
                    <ArrowRight />
                  </span>
                  <Field
                    label="Kondisi pengganti / baru"
                    htmlFor="replacementObject"
                    helperText={`${replacementObject.length}/2000 karakter`}
                    required
                  >
                    <Textarea
                      id="replacementObject"
                      value={replacementObject}
                      onChange={(event) => setReplacementObject(event.target.value)}
                      maxLength={2000}
                      placeholder="Kondisi setelah perubahan diterapkan"
                    />
                  </Field>
                </div>
              </Panel>
            )}
          </div>
          <Panel
            title="4. Penyebab dan detail"
            description="Tuliskan fakta operasional yang mendasari perubahan."
            className="henkaten-workspace-section narrative-panel"
          >
            <div className="henkaten-narrative-grid">
              <Field
                label="Penyebab"
                htmlFor="cause"
                helperText={`${cause.length}/2000 karakter`}
                required
              >
                <Textarea
                  id="cause"
                  value={cause}
                  onChange={(event) => setCause(event.target.value)}
                  maxLength={2000}
                  placeholder="Ringkas penyebab utama Henkaten"
                />
              </Field>
              <Field
                label="Detail kejadian"
                htmlFor="detail"
                helperText={`${detail.length}/2000 karakter`}
                required
              >
                <Textarea
                  id="detail"
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  maxLength={2000}
                  placeholder="Jelaskan kejadian, konteks, dan dampak operasional"
                />
              </Field>
            </div>
          </Panel>
          <Panel
            title="5. Checklist"
            description="Seluruh jawaban wajib Yes; No atau belum dijawab memblokir submission."
          >
            {!checklist?.items.length ? (
              <Alert tone="danger" title="Checklist belum published">
                Hubungi Supplier Admin untuk mengaktifkan checklist kategori ini.
              </Alert>
            ) : (
              <ChecklistResponseList
                items={checklist.items}
                answers={answers}
                onChange={(itemId, answer) => setAnswers({ ...answers, [itemId]: answer })}
              />
            )}
          </Panel>
        </div>
        <aside className="henkaten-review" aria-label="Ringkasan Henkaten">
          <span className="product-eyebrow">Tinjau submission</span>
          <div className={`submission-readiness${valid ? ' is-ready' : ''}`}>
            <ClipboardCheck aria-hidden="true" />
            <span>
              <strong>{valid ? 'Siap disubmit' : 'Belum siap submit'}</strong>
              <small>
                {valid
                  ? 'Seluruh kelengkapan form terpenuhi.'
                  : 'Lengkapi item yang masih memerlukan perhatian.'}
              </small>
            </span>
          </div>
          <h2>Ringkasan Henkaten</h2>
          <dl>
            <div>
              <dt>Kategori</dt>
              <dd>{humanize(category)}</dd>
            </div>
            <div>
              <dt>Line</dt>
              <dd>{current.data?.line.name ?? 'Belum dipilih'}</dd>
            </div>
            <div>
              <dt>Job</dt>
              <dd>
                {working.data?.find((item) => item.jobId === jobId)?.jobName ?? 'Belum dipilih'}
              </dd>
            </div>
            <div>
              <dt>Part</dt>
              <dd>{selectedPart?.partNumber ?? 'Belum dipilih'}</dd>
            </div>
            <div>
              <dt>Memenuhi</dt>
              <dd>
                {yesCount}/{checklist?.items.length ?? 0} item
              </dd>
            </div>
          </dl>
          <div className="henkaten-progress">
            <div>
              <span>Progress checklist</span>
              <strong>
                {checklist?.items.length
                  ? Math.round((yesCount / checklist.items.length) * 100)
                  : 0}
                %
              </strong>
            </div>
            <progress
              max={checklist?.items.length || 1}
              value={yesCount}
              aria-label={`${yesCount} dari ${checklist?.items.length ?? 0} checklist memenuhi persyaratan`}
            />
            <small>
              {checklistComplete
                ? 'Seluruh item checklist memenuhi persyaratan.'
                : noCount
                  ? `${noCount} jawaban No memblokir submission.`
                  : `${unansweredCount} item belum dijawab.`}
            </small>
          </div>
          <ReadinessList items={readinessItems} />
          <Button
            type="submit"
            variant="primary"
            loading={submit.isPending}
            disabled={!valid}
            leadingIcon={<ClipboardCheck />}
          >
            Submit Henkaten
          </Button>
          <Button type="button" variant="ghost" onClick={() => void navigate(-1)}>
            Batal
          </Button>
        </aside>
      </form>
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
        description="Record mungkin tidak tersedia atau di luar scope line Anda."
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
        eyebrow={`${item.sourceMode} · source epoch ${item.sourceEpoch}`}
        title={item.identifier}
        description={`Dibuat ${formatDate(item.occurredAt, item.timezone)}`}
        status={
          <div className="henkaten-header-status">
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
                reservationActive={item.man.reservationActive}
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
          <Panel
            title="Rute approval"
            description="Rute berjalan paralel; reject pertama membuat rute lain Not Required."
            className="approval-timeline-panel"
          >
            <ApprovalTimeline
              creatorName={item.creatorName}
              status={item.status}
              supervisor={item.routes.supervisor}
              qc={item.routes.qc}
              formatDate={(value) => formatDate(value, item.timezone)}
            />
          </Panel>
          <div className="detail-panels">
            <Panel
              title="Checklist snapshot"
              description={`Versi ${item.checklist.versionNumber} · immutable`}
            >
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
            <Panel
              title="Riwayat lifecycle"
              description="Evidence actor dan waktu dari event domain."
            >
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
                description="Keputusan disimpan permanen. Henkaten tetap Open bila route lain masih Pending."
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
                description="Reject membuat Henkaten terminal dan route lain menjadi Not Required. Keputusan tidak dapat dicabut."
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
                description="Responsibility route Supervisor akan dialihkan ke member aktif yang dipilih."
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
                description="Record menjadi Cancelled, reservation dan warning dilepas, dan data lama tetap immutable."
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
          <div className="record-lock-note">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Data immutable</strong>
              <small>
                Perubahan lifecycle hanya melalui action yang tersedia dan selalu divalidasi server.
              </small>
            </span>
          </div>
          <Link to={`/shifts/${item.shiftRunId}`}>
            Buka Shift <ArrowRight />
          </Link>
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
