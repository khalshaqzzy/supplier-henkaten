import { AlertTriangle, ArrowRight, Play, Square } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
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

export function ShiftListPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = scopeOf(session!);
  const status = params.get('status') as 'ACTIVE' | 'NOT_STARTED' | 'ENDED' | null;
  const businessDate = params.get('businessDate') ?? '';
  const lineId = params.get('lineId') ?? '';
  const cursor = params.get('cursor') ?? undefined;
  const shifts = useQuery({
    queryKey: scopedKey(scope, 'shifts', { status, businessDate, lineId, cursor }),
    queryFn: () =>
      supplierApi.shifts({
        limit: 25,
        ...(cursor ? { cursor } : {}),
        ...(status ? { status } : {}),
        ...(businessDate ? { businessDate } : {}),
        ...(lineId ? { lineId } : {}),
      }),
  });
  const filterOptions = useQuery({
    queryKey: scopedKey(scope, 'shift-filter-options'),
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
        eyebrow="Lifecycle operasional"
        title="Shift"
        description="Lihat planned, current, dan ended Shift Run sesuai scope line."
        actions={
          session!.principal.role === 'LINE_LEADER' ? (
            <Link className="hds-button hds-button--primary hds-button--md" to="/shifts/prepare">
              Prepare Shift
            </Link>
          ) : undefined
        }
      />
      <FilterBar>
        <label>
          <span>Status</span>
          <NativeSelect
            value={status ?? ''}
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="">Semua status</option>
            <option value="NOT_STARTED">Not Started</option>
            <option value="ACTIVE">Active</option>
            <option value="ENDED">Ended</option>
          </NativeSelect>
        </label>
        <label>
          <span>Business date</span>
          <Input
            type="date"
            value={businessDate}
            onChange={(event) => update('businessDate', event.target.value)}
          />
        </label>
        <label>
          <span>Line</span>
          <NativeSelect value={lineId} onChange={(event) => update('lineId', event.target.value)}>
            <option value="">Semua line</option>
            {filterOptions.data?.filterOptions.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      </FilterBar>
      {shifts.isLoading && <ShiftSkeleton />}
      {shifts.isError && (
        <ErrorState
          title="Shift tidak dapat dimuat"
          description="Coba ambil ulang lifecycle Shift Run."
          action={<Button onClick={() => void shifts.refetch()}>Coba lagi</Button>}
        />
      )}
      {shifts.data?.items.length === 0 && (
        <EmptyState
          title={
            status || businessDate || lineId ? 'Tidak ada hasil filter' : 'Belum ada Shift Run'
          }
          description="Line Leader dapat menyiapkan Shift Run dari default assignment terbaru."
          action={
            status || businessDate || lineId ? (
              <Button onClick={() => setParams({}, { replace: true })}>Reset filter</Button>
            ) : undefined
          }
        />
      )}
      {shifts.data && shifts.data.items.length > 0 && (
        <>
          <div className="shift-list">
            {shifts.data.items.map((shift) => (
              <Link
                key={shift.id}
                to={`/shifts/${shift.id}`}
                className={`shift-card is-${shift.status.toLowerCase()}`}
              >
                <div>
                  <span className="status-label">{humanize(shift.status)}</span>
                  <h2>
                    {shift.line.code} · {shift.line.name}
                  </h2>
                  <p>
                    {shift.shift.name} · {shift.businessDate}
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Jadwal</dt>
                    <dd>
                      {formatTime(shift.scheduledStartAt, shift.timezone)} –{' '}
                      {formatTime(shift.scheduledEndAt, shift.timezone)}
                    </dd>
                  </div>
                  <div>
                    <dt>Line Leader</dt>
                    <dd>{shift.lineLeader?.name ?? 'Belum tersedia'}</dd>
                  </div>
                  <div>
                    <dt>Preflight</dt>
                    <dd>
                      {shift.eligible
                        ? 'Eligible'
                        : `${shift.checks.filter((check) => check.blocking).length} blocker`}
                    </dd>
                  </div>
                </dl>
                {shift.startedWithOverride && (
                  <span className="override-badge">
                    <AlertTriangle />
                    Emergency override
                  </span>
                )}
                <ArrowRight aria-hidden="true" />
              </Link>
            ))}
          </div>
          <CursorPager
            nextCursor={shifts.data.pageInfo.nextCursor}
            hasNextPage={shifts.data.pageInfo.hasNextPage}
            itemCount={shifts.data.items.length}
          />
        </>
      )}
    </div>
  );
}

export function PrepareShiftPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const scope = scopeOf(session!);
  const [lineId, setLineId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [problem, setProblem] = useState<string | null>(null);
  const lines = useQuery({
    queryKey: scopedKey(scope, 'prepare-lines'),
    queryFn: () => supplierApi.lines({ limit: 100, active: 'ACTIVE' }),
  });
  const templates = useQuery({
    queryKey: scopedKey(scope, 'prepare-templates'),
    queryFn: () => supplierApi.shiftTemplates({ limit: 100, active: 'ACTIVE' }),
  });
  const prepare = useMutation({
    mutationFn: () =>
      supplierApi.prepareShift({ lineId, shiftTemplateId: templateId, businessDate }),
    onSuccess: (shift) => navigate(`/shifts/${shift.id}`),
    onError: (error) =>
      setProblem(
        error instanceof ApiProblemError ? error.problem.detail : 'Shift tidak dapat disiapkan.',
      ),
  });
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Shift Run"
        title="Prepare Shift"
        description="Buat planned Shift Run, lalu tinjau hasil preflight server sebelum Start."
      />
      {problem && (
        <Alert tone="danger" title="Prepare gagal">
          {problem}
        </Alert>
      )}
      <Panel
        title="Konteks shift"
        description="Line tetap diverifikasi terhadap responsibility Line Leader."
      >
        <form
          className="prepare-form"
          onSubmit={(event) => {
            event.preventDefault();
            prepare.mutate();
          }}
        >
          <Field label="Line" htmlFor="line" required>
            <NativeSelect
              id="line"
              value={lineId}
              onChange={(event) => setLineId(event.target.value)}
              required
            >
              <option value="">Pilih line</option>
              {lines.data?.items.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.code} · {line.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Shift Template" htmlFor="template" required>
            <NativeSelect
              id="template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              required
            >
              <option value="">Pilih template</option>
              {templates.data?.items.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.startTime}–{template.endTime}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Business date" htmlFor="businessDate" required>
            <Input
              id="businessDate"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
              required
            />
          </Field>
          <div className="form-actions">
            <Button type="submit" loading={prepare.isPending} disabled={!lineId || !templateId}>
              Jalankan preflight
            </Button>
            <Button type="button" variant="ghost" onClick={() => void navigate('/shifts')}>
              Batal
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export function ShiftDetailPage() {
  const { shiftRunId = '' } = useParams();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const scope = scopeOf(session!);
  const [problem, setProblem] = useState<string | null>(null);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [intentKey, setIntentKey] = useState(() => createIdempotencyKey());
  const shift = useQuery({
    queryKey: scopedKey(scope, 'shift-detail', shiftRunId),
    queryFn: () => supplierApi.shift(shiftRunId),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'shift-detail', shiftRunId) });
    setIntentKey(createIdempotencyKey());
  };
  const action = useMutation({
    mutationFn: async (kind: 'start' | 'emergency' | 'end') => {
      const current = shift.data!;
      if (kind === 'start')
        return supplierApi.startShift(current.id, { expectedVersion: current.version }, intentKey);
      if (kind === 'emergency')
        return supplierApi.emergencyStartShift(
          current.id,
          { expectedVersion: current.version, reason: emergencyReason },
          intentKey,
        );
      return supplierApi.endShift(current.id, { expectedVersion: current.version }, intentKey);
    },
    onSuccess: refresh,
    onError: (error) =>
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Status mutation belum pasti. Muat ulang sebelum mencoba kembali.',
      ),
  });
  if (shift.isLoading) return <ShiftSkeleton />;
  if (shift.isError || !shift.data)
    return (
      <ErrorState
        title="Shift tidak dapat dimuat"
        description="Resource tidak tersedia atau di luar scope."
        action={<Button onClick={() => void shift.refetch()}>Coba lagi</Button>}
      />
    );
  const current = shift.data;
  const blockers = current.checks.filter((check) => check.blocking);
  const canOperate = session!.principal.role === 'LINE_LEADER';
  const canEmergency = session!.principal.role === 'SUPPLIER_ADMIN';
  return (
    <div className="product-page shift-detail">
      <PageHeader
        eyebrow={`${current.line.code} · ${current.businessDate}`}
        title={`${current.shift.name} Shift`}
        description={`${current.line.name} · ${humanize(current.status)} · ${current.timezone}`}
        actions={
          current.status === 'NOT_STARTED' && canOperate ? (
            <Button
              leadingIcon={<Play />}
              disabled={!current.eligible}
              loading={action.isPending}
              onClick={() => action.mutate('start')}
            >
              Start Shift
            </Button>
          ) : current.status === 'ACTIVE' && canOperate ? (
            <Button
              variant="danger"
              leadingIcon={<Square />}
              loading={action.isPending}
              onClick={() => {
                const consequence = current.workingAssignments.filter((item) => item.active).length;
                if (
                  window.confirm(
                    `End Shift akan menutup Henkaten Open, melepas reservation, dan menonaktifkan ${consequence} Working Assignment. Lanjutkan?`,
                  )
                )
                  action.mutate('end');
              }}
            >
              End Shift
            </Button>
          ) : undefined
        }
      />
      {problem && (
        <Alert tone="danger" title="Action gagal">
          {problem}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Refresh state
          </Button>
        </Alert>
      )}
      {current.status === 'NOT_STARTED' && (
        <Alert
          tone={current.eligible ? 'success' : 'danger'}
          title={
            current.eligible
              ? 'Preflight eligible'
              : 'Preflight blocked — Shift belum dapat dimulai'
          }
        >
          {current.eligible
            ? 'Semua gate server lulus. Line Leader dapat memulai Shift.'
            : `${blockers.length} blocker harus diselesaikan atau menggunakan Emergency Start yang berwenang.`}
        </Alert>
      )}
      {current.startedWithOverride && (
        <Alert tone="danger" title="Emergency Start aktif">
          {current.overrideReason}
        </Alert>
      )}
      <section className="shift-facts">
        <Fact label="Status" value={humanize(current.status)} />
        <Fact label="Business date" value={current.businessDate} />
        <Fact label="Supervisor" value={current.supervisor?.name ?? 'Kosong'} />
        <Fact label="Line Leader" value={current.lineLeader?.name ?? 'Kosong'} />
        <Fact
          label="Jadwal"
          value={`${formatTime(current.scheduledStartAt, current.timezone)}–${formatTime(current.scheduledEndAt, current.timezone)}`}
        />
      </section>
      {blockers.length > 0 && (
        <Panel
          title={`Blocking issues (${blockers.length})`}
          description="Hanya checks yang dikembalikan API yang ditampilkan."
        >
          <div className="preflight-grid">
            {blockers.map((check, index) => (
              <article key={`${check.code}-${index}`}>
                <AlertTriangle aria-hidden="true" />
                <span>
                  <strong>{humanize(check.code)}</strong>
                  <p>{check.message}</p>
                  <code>{check.code}</code>
                </span>
                {check.resourceId && (
                  <Link to={`/shifts/${current.id}/resolve`}>
                    Buka resolusi <ArrowRight />
                  </Link>
                )}
              </article>
            ))}
          </div>
        </Panel>
      )}
      <Panel
        title="Working Assignment"
        description={`${current.workingAssignments.length} job pada snapshot Shift Run.`}
      >
        <div className="working-grid">
          {current.workingAssignments.map((assignment) => (
            <article key={assignment.id} className={`is-${assignment.state.toLowerCase()}`}>
              <span>{String(assignment.jobDisplayOrder).padStart(2, '0')}</span>
              <div>
                <strong>{assignment.jobName}</strong>
                <small>{assignment.mpName ?? 'Vacant'}</small>
              </div>
              <em>{humanize(assignment.state)}</em>
            </article>
          ))}
        </div>
      </Panel>
      {!current.eligible && current.status === 'NOT_STARTED' && canEmergency && (
        <Panel
          title="Emergency Start"
          description="Hanya untuk exception yang disetujui; alasan minimal 10 karakter dan diaudit."
        >
          <Field label="Alasan override" htmlFor="emergencyReason" required>
            <Textarea
              id="emergencyReason"
              value={emergencyReason}
              onChange={(event) => setEmergencyReason(event.target.value)}
              maxLength={1000}
            />
          </Field>
          <Button
            variant="danger"
            leadingIcon={<AlertTriangle />}
            disabled={emergencyReason.trim().length < 10}
            loading={action.isPending}
            onClick={() => {
              if (window.confirm('Mulai Shift walaupun preflight masih blocked?'))
                action.mutate('emergency');
            }}
          >
            Emergency Start
          </Button>
        </Panel>
      )}
      {current.status === 'ENDED' && current.endSummary && (
        <Panel title="Terminal summary" description="Shift ended bersifat final.">
          <dl className="terminal-summary">
            {Object.entries(current.endSummary).map(([key, value]) => (
              <div key={key}>
                <dt>{humanize(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </div>
  );
}

export function ShiftResolutionPage() {
  const { shiftRunId = '' } = useParams();
  const { session } = useSession();
  const scope = scopeOf(session!);
  const context = useQuery({
    queryKey: scopedKey(scope, 'shift-resolution', shiftRunId),
    queryFn: () => supplierApi.resolutionContext(shiftRunId),
  });
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Assignment Resolution"
        title="Selesaikan vacancy dan conflict"
        description="Issue hanya dianggap selesai setelah movement Approved atau Shift berakhir."
      />
      {context.isLoading && <ShiftSkeleton />}
      {context.data?.issues.length === 0 && (
        <EmptyState
          title="Tidak ada issue terbuka"
          description="Preflight dapat dijalankan kembali dari detail Shift."
        />
      )}
      {context.data && context.data.issues.length > 0 && (
        <div className="resolution-list">
          {context.data.issues.map((issue) => (
            <article key={issue.id}>
              <AlertTriangle />
              <div>
                <span>{humanize(issue.type)}</span>
                <strong>Job {issue.jobId}</strong>
                <small>Dibuka {new Date(issue.openedAt).toLocaleString('id-ID')}</small>
              </div>
              {issue.resolutionHenkatenId ? (
                <Link to={`/henkatens/${issue.resolutionHenkatenId}`}>
                  Lihat resolution Henkaten
                </Link>
              ) : (
                <Link
                  to={`/henkatens/new?shiftRunId=${shiftRunId}&jobId=${issue.jobId}&resolutionIssueId=${issue.id}`}
                >
                  Buat Man Henkaten
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function ShiftSkeleton() {
  return (
    <div className="list-skeleton">
      {Array.from({ length: 7 }, (_, index) => (
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
function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(value),
  );
}
