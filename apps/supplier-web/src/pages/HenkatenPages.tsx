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
                    <td>
                      <strong>{item.identifier}</strong>
                      <small>
                        {item.sourceMode} · epoch {item.sourceEpoch}
                      </small>
                    </td>
                    <td>
                      <span className={`category-badge is-${item.category.toLowerCase()}`}>
                        {humanize(item.category)}
                      </span>
                    </td>
                    <td>
                      {item.line.code} · {item.jobName}
                    </td>
                    <td>
                      <strong>{item.part.number}</strong>
                      <small>{item.part.name}</small>
                    </td>
                    <td>
                      {item.businessDate}
                      <small>{formatDate(item.occurredAt, session!.supplier!.timezone)}</small>
                    </td>
                    <td>
                      <RouteStatus value={item.routes.supervisor.status} />
                    </td>
                    <td>
                      <RouteStatus value={item.routes.qc.status} />
                    </td>
                    <td>
                      <span className={`status-label is-${item.status.toLowerCase()}`}>
                        {humanize(item.status)}
                      </span>
                    </td>
                    <td>
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
  const target = working.data?.find((assignment) => assignment.id === targetAssignmentId);
  const replacement = formOptions.data?.replacementMembers.find(
    (member) => member.id === replacementMpId,
  );
  const checklistComplete =
    Boolean(checklist?.items.length) &&
    checklist!.items.every((item) => answers[item.id] === 'YES');
  const answeredCount = checklist?.items.filter((item) => answers[item.id] === 'YES').length ?? 0;
  const valid =
    Boolean(
      effectiveShiftId && jobId && partId && cause.trim() && detail.trim() && checklistComplete,
    ) &&
    (category === 'MAN'
      ? Boolean(target && replacement && !replacement.reserved)
      : Boolean(affectedObject.trim() && replacementObject.trim()));
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
          >
            <div className="category-picker">
              {(['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={category === value ? 'is-selected' : undefined}
                  onClick={() => setCategory(value)}
                >
                  <span>{value[0]}</span>
                  {humanize(value)}
                  {category === value && <Check />}
                </button>
              ))}
            </div>
          </Panel>
          <div className="form-two-col">
            <Panel title="2. Target operasional">
              <Field
                label="Shift Run"
                htmlFor="shift"
                helperText={
                  current.data
                    ? `${current.data.line.code} · ${current.data.businessDate}`
                    : 'Belum tersedia'
                }
                required
              >
                <Input
                  id="shift"
                  value={
                    current.data
                      ? `${current.data.shift.name} · ${current.data.businessDate}`
                      : effectiveShiftId
                  }
                  readOnly
                />
              </Field>
              <Field label="Target job" htmlFor="job" required>
                <NativeSelect
                  id="job"
                  value={jobId}
                  onChange={(event) => {
                    setJobId(event.target.value);
                    setTargetAssignmentId(
                      working.data?.find((item) => item.jobId === event.target.value)?.id ?? '',
                    );
                  }}
                >
                  <option value="">Pilih job</option>
                  {working.data?.map((assignment) => (
                    <option key={assignment.id} value={assignment.jobId}>
                      {assignment.jobName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Cari part" htmlFor="part-search">
                <Input
                  id="part-search"
                  value={partSearch}
                  placeholder="Cari nomor atau nama part"
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
                  onChange={(event) => setPartId(event.target.value)}
                >
                  <option value="">Pilih part</option>
                  {formOptions.data?.parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.partNumber} · {part.partName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </Panel>
            {category === 'MAN' ? (
              <Panel
                title="3. Pergerakan Man"
                description="Target state dan replacement divalidasi ulang saat submit."
              >
                <Field label="Target assignment" htmlFor="targetAssignment" required>
                  <NativeSelect
                    id="targetAssignment"
                    value={targetAssignmentId}
                    onChange={(event) => {
                      setTargetAssignmentId(event.target.value);
                      setJobId(
                        working.data?.find((item) => item.id === event.target.value)?.jobId ?? '',
                      );
                    }}
                  >
                    <option value="">Pilih assignment</option>
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
                    onChange={(event) => setReplacementMpId(event.target.value)}
                  >
                    <option value="">Pilih MP</option>
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
              </Panel>
            ) : (
              <Panel title="3. Perubahan objek">
                <Field label="Objek terdampak" htmlFor="affected" required>
                  <Input
                    id="affected"
                    value={affectedObject}
                    onChange={(event) => setAffectedObject(event.target.value)}
                    maxLength={2000}
                  />
                </Field>
                <Field label="Kondisi pengganti / baru" htmlFor="replacementObject" required>
                  <Input
                    id="replacementObject"
                    value={replacementObject}
                    onChange={(event) => setReplacementObject(event.target.value)}
                    maxLength={2000}
                  />
                </Field>
              </Panel>
            )}
            {category === 'MAN' && replacement?.currentAssignment && (
              <Alert tone="info" title="Replacement berasal dari assignment aktif">
                Atomic movement akan memindahkan {replacement.fullName} dari{' '}
                {replacement.currentAssignment.lineName}/{replacement.currentAssignment.jobName};
                assignment sumber dapat menjadi vacant dan memerlukan resolution berikutnya.
              </Alert>
            )}
          </div>
          <Panel title="4. Penyebab dan detail">
            <div className="form-two-col">
              <Field label="Penyebab" htmlFor="cause" required>
                <Textarea
                  id="cause"
                  value={cause}
                  onChange={(event) => setCause(event.target.value)}
                  maxLength={2000}
                />
              </Field>
              <Field label="Detail kejadian" htmlFor="detail" required>
                <Textarea
                  id="detail"
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  maxLength={2000}
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
              <ol className="checklist-answers">
                {checklist.items.map((item, index) => (
                  <li key={item.id}>
                    <span>{index + 1}</span>
                    <strong>{item.label}</strong>
                    <NativeSelect
                      aria-label={`Jawaban checklist: ${item.label}`}
                      value={answers[item.id] ?? ''}
                      onChange={(event) =>
                        setAnswers({ ...answers, [item.id]: event.target.value as 'YES' | 'NO' })
                      }
                    >
                      <option value="">Belum dijawab</option>
                      <option value="YES">Yes</option>
                      <option value="NO">No</option>
                    </NativeSelect>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <aside className="henkaten-review" aria-label="Ringkasan Henkaten">
          <span className="product-eyebrow">Tinjau submission</span>
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
              <dd>
                {formOptions.data?.parts.find((item) => item.id === partId)?.partNumber ??
                  'Belum dipilih'}
              </dd>
            </div>
            <div>
              <dt>Checklist</dt>
              <dd>
                {answeredCount}/{checklist?.items.length ?? 0} Yes
              </dd>
            </div>
          </dl>
          <div className="henkaten-progress">
            <div>
              <span>Progress checklist</span>
              <strong>
                {checklist?.items.length
                  ? Math.round((answeredCount / checklist.items.length) * 100)
                  : 0}
                %
              </strong>
            </div>
            <progress
              max={checklist?.items.length || 1}
              value={answeredCount}
              aria-label={`${answeredCount} dari ${checklist?.items.length ?? 0} checklist dijawab Yes`}
            />
            <small>
              {checklistComplete
                ? 'Checklist lengkap dan siap disubmit.'
                : `${Math.max((checklist?.items.length ?? 0) - answeredCount, 0)} item tersisa.`}
            </small>
          </div>
          {!checklistComplete && (
            <Alert tone="warning" title="Checklist belum lengkap">
              Jawab Yes pada semua item sebelum submit.
            </Alert>
          )}
          <Button
            type="submit"
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
        description={`${humanize(item.category)} · dibuat ${formatDate(item.occurredAt, item.timezone)}`}
        status={
          <span className={`status-label is-${item.status.toLowerCase()}`}>
            {humanize(item.status)}
          </span>
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
          <div className="detail-panels">
            <Panel title="Penyebab & detail">
              <dl className="stacked-details">
                <div>
                  <dt>Penyebab</dt>
                  <dd>{item.cause}</dd>
                </div>
                <div>
                  <dt>Detail</dt>
                  <dd>{item.detail}</dd>
                </div>
              </dl>
            </Panel>
            <Panel
              title={
                item.category === 'MAN'
                  ? 'Reservation & perpindahan'
                  : 'Objek terdampak / pengganti'
              }
            >
              {item.man ? (
                <div className="movement-card">
                  <div>
                    <span>Target sebelumnya</span>
                    <strong>
                      {item.man.replacedWasVacant ? 'VACANT' : item.man.replacedMpName}
                    </strong>
                  </div>
                  <ArrowRight />
                  <div>
                    <span>Replacement MP</span>
                    <strong>{item.man.replacementMpName}</strong>
                    <small>
                      {item.man.reservationActive ? 'Reservation aktif' : 'Reservation selesai'}
                    </small>
                  </div>
                </div>
              ) : (
                <dl className="stacked-details">
                  <div>
                    <dt>Objek terdampak</dt>
                    <dd>{item.affectedObject}</dd>
                  </div>
                  <div>
                    <dt>Kondisi pengganti</dt>
                    <dd>{item.replacementObject}</dd>
                  </div>
                </dl>
              )}
            </Panel>
          </div>
          <Panel
            title="Rute approval"
            description="Rute berjalan paralel; reject pertama membuat rute lain Not Required."
          >
            <div className="approval-route">
              <RouteStep label="Submitted" state="APPROVED" person={item.creatorName} />
              <RouteStep
                label="Supervisor"
                state={item.routes.supervisor.status}
                person={item.routes.supervisor.currentResponsibleName ?? 'Belum ditetapkan'}
              />
              <RouteStep
                label="QC"
                state={item.routes.qc.status}
                person={item.routes.qc.currentResponsibleName ?? 'Shared QC queue'}
              />
              <RouteStep
                label="Completed"
                state={item.status === 'OPEN' ? 'PENDING' : item.status}
                person={humanize(item.status)}
              />
            </div>
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
          <h2>{canDecide ? `Keputusan ${humanize(route.route)}` : 'Tindakan record'}</h2>
          <div className="route-pills">
            <RouteStatus value={item.routes.supervisor.status} />
            <RouteStatus value={item.routes.qc.status} />
          </div>
          {canDecide && (
            <>
              <Field label="Catatan (opsional)" htmlFor="decision-comment">
                <Textarea
                  id="decision-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={2000}
                />
              </Field>
              <Button
                leadingIcon={<Check />}
                loading={action.isPending}
                onClick={() => {
                  if (window.confirm('Approve route ini secara permanen?'))
                    action.mutate('approve');
                }}
              >
                Approve
              </Button>
              <Button
                variant="danger"
                leadingIcon={<XCircle />}
                loading={action.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      'Reject Henkaten ini? Keputusan bersifat terminal dan tidak dapat dicabut.',
                    )
                  )
                    action.mutate('reject');
                }}
              >
                Reject
              </Button>
            </>
          )}
          {canReroute && (
            <>
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
              <Button
                variant="secondary"
                disabled={!rerouteMemberId}
                loading={action.isPending}
                onClick={() => {
                  if (window.confirm('Alihkan route Supervisor ke member terpilih?'))
                    action.mutate('reroute');
                }}
              >
                Reroute Supervisor
              </Button>
            </>
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
            <>
              <Field label="Alasan Withdraw" htmlFor="withdraw-reason">
                <Textarea
                  id="withdraw-reason"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={1000}
                />
              </Field>
              <Button
                variant="danger"
                disabled={!comment.trim()}
                loading={action.isPending}
                onClick={() => {
                  if (window.confirm('Withdraw Henkaten Open ini? Record lama tetap immutable.'))
                    action.mutate('withdraw');
                }}
              >
                Withdraw
              </Button>
            </>
          )}
          <Link to={`/shifts/${item.shiftRunId}`}>
            Buka Shift <ArrowRight />
          </Link>
        </aside>
      </div>
    </div>
  );
}

function RouteStep({ label, state, person }: { label: string; state: string; person: string }) {
  return (
    <div className={`is-${state.toLowerCase()}`}>
      <span>
        {state === 'APPROVED' ? <Check /> : state === 'REJECTED' ? <XCircle /> : <ShieldCheck />}
      </span>
      <strong>{label}</strong>
      <small>{person}</small>
      <em>{humanize(state)}</em>
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
