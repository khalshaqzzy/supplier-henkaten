import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { LineShift } from '@tmmin-henkaten/contracts';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  NativeSelect,
  Panel,
  Skeleton,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';

export function DefaultAssignmentsPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [newShiftTemplateId, setNewShiftTemplateId] = useState('');
  const [copyFromId, setCopyFromId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const lines = useQuery({
    queryKey: scopedKey(scope, 'line-setup-lines'),
    queryFn: () => supplierApi.lines({ limit: 100, active: 'ACTIVE' }),
  });
  const members = useQuery({
    queryKey: scopedKey(scope, 'line-setup-members'),
    queryFn: () => supplierApi.members({ limit: 100, active: 'ACTIVE' }),
  });
  const templates = useQuery({
    queryKey: scopedKey(scope, 'line-setup-shifts'),
    queryFn: () => supplierApi.shiftTemplates({ limit: 100, active: 'ACTIVE' }),
  });
  const lineId = params.get('lineId') || lines.data?.items[0]?.id || '';
  const lineShifts = useQuery({
    queryKey: scopedKey(scope, 'line-shifts', lineId),
    queryFn: () => supplierApi.lineShifts(lineId),
    enabled: Boolean(lineId),
  });
  const selected =
    lineShifts.data?.items.find(({ id }) => id === selectedShiftId) ?? lineShifts.data?.items[0];

  useEffect(() => {
    if (selected && selected.id !== selectedShiftId) setSelectedShiftId(selected.id);
  }, [selected, selectedShiftId]);

  const availableTemplates = useMemo(() => {
    const configured = new Set(
      lineShifts.data?.items.map(({ shiftTemplateId }) => shiftTemplateId),
    );
    return templates.data?.items.filter(({ id }) => !configured.has(id)) ?? [];
  }, [lineShifts.data, templates.data]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'line-shifts', lineId) }),
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'setup-readiness') }),
    ]);
  };
  const addShift = useMutation({
    mutationFn: () =>
      supplierApi.createLineShift(lineId, {
        shiftTemplateId: newShiftTemplateId,
        ...(copyFromId ? { copyFromLineShiftId: copyFromId } : {}),
      }),
    onSuccess: async (created) => {
      setProblem(null);
      setNewShiftTemplateId('');
      setCopyFromId('');
      setSelectedShiftId(created.id);
      await invalidate();
    },
    onError: (error) => setProblem(problemDetail(error, 'Shift tidak dapat ditambahkan.')),
  });
  const action = useMutation({
    mutationFn: ({ item, active }: { item: LineShift; active: boolean }) =>
      supplierApi.lineShiftAction(item.id, active ? 'activate' : 'deactivate', item.version),
    onSuccess: invalidate,
    onError: (error) => setProblem(problemDetail(error, 'Status shift tidak dapat diubah.')),
  });
  const loading =
    lines.isLoading || members.isLoading || templates.isLoading || lineShifts.isLoading;

  return (
    <div className="product-page">
      <PageHeader eyebrow="Master Data" title="Line Setup" description="" />
      <div className="defaults-toolbar">
        <label>
          <span>Line</span>
          <NativeSelect
            value={lineId}
            onChange={(event) => {
              setSelectedShiftId('');
              setParams({ lineId: event.target.value }, { replace: true });
            }}
          >
            {lines.data?.items.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      {problem && (
        <Alert tone="danger" title="Perubahan gagal">
          {problem}
        </Alert>
      )}
      {loading && (
        <div className="list-skeleton">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {(lines.isError || members.isError || templates.isError || lineShifts.isError) && (
        <ErrorState
          title="Line Setup tidak dapat dimuat"
          description=""
          action={<Button onClick={() => void lineShifts.refetch()}>Coba lagi</Button>}
        />
      )}
      {!loading && !lineId && <EmptyState title="Belum ada line aktif" description="" />}
      {lineId && lineShifts.data && (
        <>
          <Panel title="Shift line">
            <div className="defaults-toolbar">
              <label>
                <span>Shift baru</span>
                <NativeSelect
                  value={newShiftTemplateId}
                  onChange={(event) => setNewShiftTemplateId(event.target.value)}
                >
                  <option value="">Pilih shift</option>
                  {availableTemplates.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.name} · {shift.startTime}–{shift.endTime}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                <span>Salin assignment</span>
                <NativeSelect
                  value={copyFromId}
                  onChange={(event) => setCopyFromId(event.target.value)}
                >
                  <option value="">Tanpa salinan</option>
                  {lineShifts.data.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.shiftName}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <Button
                disabled={!newShiftTemplateId}
                loading={addShift.isPending}
                onClick={() => addShift.mutate()}
              >
                Tambah shift
              </Button>
            </div>
            {lineShifts.data.items.length > 0 && (
              <div className="defaults-toolbar" role="tablist" aria-label="Shift line">
                {lineShifts.data.items.map((item) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant={selected?.id === item.id ? 'primary' : 'secondary'}
                    onClick={() => setSelectedShiftId(item.id)}
                  >
                    {item.shiftName} · {item.startTime}–{item.endTime}
                    {item.active ? '' : ' · Nonaktif'}
                  </Button>
                ))}
              </div>
            )}
          </Panel>
          {selected ? (
            <AssignmentEditor
              key={`${selected.id}:${selected.version}`}
              item={selected}
              members={members.data?.items ?? []}
              onSaved={invalidate}
              onProblem={setProblem}
              onToggle={() => action.mutate({ item: selected, active: !selected.active })}
              toggling={action.isPending}
            />
          ) : (
            <EmptyState title="Belum ada shift pada line ini" description="" />
          )}
        </>
      )}
    </div>
  );
}

type Member = Awaited<ReturnType<typeof supplierApi.members>>['items'][number];

function AssignmentEditor({
  item,
  members,
  onSaved,
  onProblem,
  onToggle,
  toggling,
}: {
  item: LineShift;
  members: Member[];
  onSaved: () => Promise<void>;
  onProblem: (value: string | null) => void;
  onToggle: () => void;
  toggling: boolean;
}) {
  const [supervisorId, setSupervisorId] = useState(item.supervisorMemberId ?? '');
  const [leaderId, setLeaderId] = useState(item.lineLeaderMemberId ?? '');
  const [mps, setMps] = useState<Record<string, string>>(
    Object.fromEntries(item.assignments.map(({ jobId, mpMemberId }) => [jobId, mpMemberId ?? ''])),
  );
  const save = useMutation({
    mutationFn: () =>
      supplierApi.updateLineShiftAssignments(item.id, {
        expectedVersion: item.version,
        supervisorMemberId: supervisorId || null,
        lineLeaderMemberId: leaderId || null,
        jobs: item.assignments.map(({ jobId }) => ({ jobId, mpMemberId: mps[jobId] || null })),
      }),
    onSuccess: async () => {
      onProblem(null);
      await onSaved();
    },
    onError: (error) => onProblem(problemDetail(error, 'Assignment tidak dapat disimpan.')),
  });
  const role = (name: Member['role']) => members.filter((member) => member.role === name);
  return (
    <Panel title={`${item.shiftName} · ${item.startTime}–${item.endTime}`}>
      <div className="defaults-summary">
        <MemberSelect
          label="Supervisor"
          value={supervisorId}
          members={role('SUPERVISOR')}
          onChange={setSupervisorId}
        />
        <MemberSelect
          label="Line Leader"
          value={leaderId}
          members={role('LINE_LEADER')}
          onChange={setLeaderId}
        />
      </div>
      <div className="defaults-table">
        <div className="defaults-table__head">
          <span>Urutan</span>
          <span>Job</span>
          <span>MP</span>
        </div>
        {item.assignments.map((assignment) => (
          <div className="defaults-table__row" key={assignment.id}>
            <span className="order-pill">
              {String(assignment.jobDisplayOrder).padStart(2, '0')}
            </span>
            <strong>{assignment.jobName}</strong>
            <NativeSelect
              value={mps[assignment.jobId] ?? ''}
              onChange={(event) =>
                setMps((current) => ({ ...current, [assignment.jobId]: event.target.value }))
              }
            >
              <option value="">Pilih MP</option>
              {role('MP').map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} · {member.registrationNumber}
                </option>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      <div className="assignment-sheet-actions">
        <Button variant="secondary" loading={toggling} onClick={onToggle}>
          {item.active ? 'Nonaktifkan shift' : 'Aktifkan shift'}
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Simpan assignment
        </Button>
      </div>
    </Panel>
  );
}

function MemberSelect({
  label,
  value,
  members,
  onChange,
}: {
  label: string;
  value: string;
  members: Member[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="sheet-field">
      <span>{label}</span>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Pilih {label}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.fullName} · {member.registrationNumber}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

function problemDetail(error: unknown, fallback: string) {
  return error instanceof ApiProblemError ? error.problem.detail : fallback;
}
