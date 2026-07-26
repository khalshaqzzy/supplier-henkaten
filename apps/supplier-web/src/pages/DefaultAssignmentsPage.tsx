import { AlertTriangle, ArrowRightLeft, CheckCircle2, UserPlus, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  NativeSelect,
  Panel,
  Sheet,
  Skeleton,
} from '@tmmin-henkaten/ui';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';

type AssignmentKind = 'supervisor' | 'leader' | 'mp';

export function DefaultAssignmentsPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{
    kind: AssignmentKind;
    resourceId: string;
    currentMemberId: string | undefined;
    assignmentId: string | undefined;
    version: number | undefined;
  } | null>(null);
  const [selectedMember, setSelectedMember] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeEditor = () => {
    setEditor(null);
    setSelectedMember('');
    queueMicrotask(() => returnFocusRef.current?.focus());
  };
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const lines = useQuery({
    queryKey: scopedKey(scope, 'master-lines-defaults'),
    queryFn: () => supplierApi.lines({ limit: 100, active: 'ACTIVE' }),
  });
  const members = useQuery({
    queryKey: scopedKey(scope, 'master-members-defaults'),
    queryFn: () => supplierApi.members({ limit: 100, active: 'ACTIVE' }),
  });
  const assignments = useQuery({
    queryKey: scopedKey(scope, 'default-assignments'),
    queryFn: () => supplierApi.defaultAssignments(),
  });
  const lineId = params.get('lineId') || lines.data?.items[0]?.id || '';
  const jobs = useQuery({
    queryKey: scopedKey(scope, 'line-jobs-defaults', lineId),
    queryFn: () => supplierApi.jobs(lineId, { limit: 100, active: 'ACTIVE' }),
    enabled: Boolean(lineId),
  });
  const activeShift = useQuery({
    queryKey: scopedKey(scope, 'current-shift-defaults', lineId),
    queryFn: () => supplierApi.currentShift({ lineId }),
    enabled: Boolean(lineId),
  });
  const memberMap = useMemo(
    () => new Map(members.data?.items.map((member) => [member.id, member]) ?? []),
    [members.data],
  );
  const mutation = useMutation({
    mutationFn: async () => {
      if (!editor || !selectedMember) throw new Error('SelectionRequired');
      const collection =
        editor.kind === 'supervisor'
          ? assignments.data!.supervisors
          : editor.kind === 'leader'
            ? assignments.data!.lineLeaders
            : assignments.data!.mps;
      const occupied = collection.find(
        (assignment) =>
          assignment.memberId === selectedMember && assignment.resourceId !== editor.resourceId,
      );
      if (occupied && editor.kind !== 'supervisor') {
        const confirmed = window.confirm(
          'Member sudah assigned pada resource lain. Lakukan atomic move ke target baru?',
        );
        if (!confirmed) throw new Error('MoveCancelled');
        return supplierApi.moveDefault(editor.kind, editor.resourceId, {
          memberId: selectedMember,
          fromResourceId: occupied.resourceId,
          expectedSourceVersion: occupied.version,
          ...(editor.version === undefined ? {} : { expectedTargetVersion: editor.version }),
        });
      }
      return supplierApi.assignDefault(editor.kind, editor.resourceId, {
        memberId: selectedMember,
        ...(editor.version === undefined ? {} : { expectedAssignmentVersion: editor.version }),
      });
    },
    onSuccess: async () => {
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'default-assignments') });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'MoveCancelled') return;
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Assignment berubah atau member tidak lagi tersedia. Muat ulang dan pilih kembali.',
      );
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!editor?.assignmentId || editor.version === undefined)
        throw new Error('AssignmentMissing');
      const kind =
        editor.kind === 'supervisor'
          ? 'supervisors'
          : editor.kind === 'leader'
            ? 'line-leaders'
            : 'mps';
      return supplierApi.removeAssignment(kind, editor.resourceId, {
        expectedAssignmentVersion: editor.version,
      });
    },
    onSuccess: async () => {
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'default-assignments') });
    },
    onError: (error) =>
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Assignment sudah berubah. Muat ulang sebelum menghapus.',
      ),
  });

  const lineAssignment = (kind: 'supervisors' | 'lineLeaders') =>
    assignments.data?.[kind].find((assignment) => assignment.resourceId === lineId);
  const loading = lines.isLoading || members.isLoading || assignments.isLoading;
  const editorCollection =
    editor && assignments.data
      ? editor.kind === 'supervisor'
        ? assignments.data.supervisors
        : editor.kind === 'leader'
          ? assignments.data.lineLeaders
          : assignments.data.mps
      : [];
  const occupiedAssignment = editorCollection.find(
    (assignment) =>
      assignment.memberId === selectedMember && assignment.resourceId !== editor?.resourceId,
  );

  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Master Data"
        title="Default Assignment"
        description="Tetapkan Supervisor, Line Leader, dan MP untuk future Shift Run."
      />
      <div className="defaults-toolbar">
        <label>
          <span>Line</span>
          <NativeSelect
            value={lineId}
            onChange={(event) => setParams({ lineId: event.target.value }, { replace: true })}
          >
            {lines.data?.items.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="defaults-legend">
          <span>
            <i className="is-assigned" />
            Assigned
          </span>
          <span>
            <i className="is-empty" />
            Belum assigned
          </span>
        </div>
      </div>
      {activeShift.data?.status === 'ACTIVE' && (
        <Alert tone="info" title="Shift aktif sedang berjalan">
          Perubahan default hanya berlaku untuk shift berikutnya dan tidak mengubah Working
          Assignment saat ini.
        </Alert>
      )}
      {problem && !editor && (
        <Alert tone="danger" title="Assignment gagal">
          {problem}
        </Alert>
      )}
      {loading && (
        <div className="list-skeleton">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} />
          ))}
        </div>
      )}
      {(lines.isError || members.isError || assignments.isError) && (
        <ErrorState
          title="Default Assignment tidak dapat dimuat"
          description="Hierarchy dan version harus diambil bersama dari server."
          action={<Button onClick={() => void assignments.refetch()}>Coba lagi</Button>}
        />
      )}
      {!loading && !lineId && (
        <EmptyState
          title="Belum ada line aktif"
          description="Buat line dan job sebelum menetapkan default assignment."
        />
      )}
      {assignments.data && lineId && (
        <>
          <section className="defaults-summary">
            <AssignmentSummary
              label="Supervisor default"
              assignment={lineAssignment('supervisors')}
              memberMap={memberMap}
              onEdit={(assignment, trigger) => {
                returnFocusRef.current = trigger;
                setProblem(null);
                setEditor({
                  kind: 'supervisor',
                  resourceId: lineId,
                  currentMemberId: assignment?.memberId,
                  assignmentId: assignment?.id,
                  version: assignment?.version,
                });
                setSelectedMember(assignment?.memberId ?? '');
              }}
            />
            <AssignmentSummary
              label="Line Leader default"
              assignment={lineAssignment('lineLeaders')}
              memberMap={memberMap}
              onEdit={(assignment, trigger) => {
                returnFocusRef.current = trigger;
                setProblem(null);
                setEditor({
                  kind: 'leader',
                  resourceId: lineId,
                  currentMemberId: assignment?.memberId,
                  assignmentId: assignment?.id,
                  version: assignment?.version,
                });
                setSelectedMember(assignment?.memberId ?? '');
              }}
            />
            <div className="defaults-summary__metric">
              <Users aria-hidden="true" />
              <span>
                <strong>{jobs.data?.items.length ?? 0}</strong>
                <small>Job aktif</small>
              </span>
            </div>
          </section>
          <Panel
            title="MP per job"
            description="Satu MP hanya boleh menjadi default pada satu job."
          >
            <div className="defaults-table">
              <div className="defaults-table__head">
                <span>Urutan</span>
                <span>Job</span>
                <span>MP default</span>
                <span>Status</span>
                <span />
              </div>
              {jobs.data?.items.map((job) => {
                const assignment = assignments.data.mps.find((item) => item.resourceId === job.id);
                const member = assignment ? memberMap.get(assignment.memberId) : undefined;
                return (
                  <div key={job.id} className="defaults-table__row">
                    <span className="order-pill">{String(job.displayOrder).padStart(2, '0')}</span>
                    <strong>{job.name}</strong>
                    <Person member={member} />
                    <span className={assignment ? 'status-ok' : 'status-missing'}>
                      {assignment ? <CheckCircle2 /> : <AlertTriangle />}
                      {assignment ? 'Assigned' : 'Kosong'}
                    </span>
                    <Button
                      size="sm"
                      variant={assignment ? 'secondary' : 'primary'}
                      onClick={(event) => {
                        returnFocusRef.current = event.currentTarget;
                        setProblem(null);
                        setEditor({
                          kind: 'mp',
                          resourceId: job.id,
                          currentMemberId: assignment?.memberId,
                          assignmentId: assignment?.id,
                          version: assignment?.version,
                        });
                        setSelectedMember(assignment?.memberId ?? '');
                      }}
                    >
                      {assignment ? 'Ganti' : 'Assign'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}
      {editor && (
        <Sheet
          trigger={<button type="button" hidden />}
          open
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
          title={editor.currentMemberId ? 'Ubah Default Assignment' : 'Assign Member'}
          description="Konflik uniqueness diselesaikan sebagai atomic move dengan version check."
          footer={
            <div className="assignment-sheet-actions">
              {editor.assignmentId && (
                <Button
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => {
                    if (window.confirm('Hapus default assignment ini?')) remove.mutate();
                  }}
                >
                  Hapus assignment
                </Button>
              )}
              <Button variant="ghost" onClick={closeEditor}>
                Batal
              </Button>
              <Button
                leadingIcon={<ArrowRightLeft />}
                loading={mutation.isPending}
                disabled={!selectedMember}
                onClick={() => mutation.mutate()}
              >
                Konfirmasi perubahan
              </Button>
            </div>
          }
        >
          <div className="assignment-change-preview">
            <section>
              <span>Dari kondisi saat ini</span>
              <strong>
                {editor.currentMemberId
                  ? (memberMap.get(editor.currentMemberId)?.fullName ?? 'Member tidak tersedia')
                  : 'Belum assigned'}
              </strong>
              <small>
                {editor.currentMemberId
                  ? memberMap.get(editor.currentMemberId)?.registrationNumber
                  : 'Tidak ada default pada target'}
              </small>
            </section>
            <ArrowRightLeft aria-hidden="true" />
            <section>
              <span>Ke kondisi baru</span>
              <strong>
                {selectedMember
                  ? (memberMap.get(selectedMember)?.fullName ?? 'Pilih member')
                  : 'Pilih member'}
              </strong>
              <small>
                {occupiedAssignment
                  ? 'Member akan dipindahkan secara atomik'
                  : 'Assignment target akan diperbarui'}
              </small>
            </section>
          </div>
          <FieldSelect
            kind={editor.kind}
            value={selectedMember}
            members={members.data?.items ?? []}
            onChange={setSelectedMember}
          />
          <Alert tone="warning" title="Efektif untuk future shift">
            Working Assignment aktif tidak berubah. Audit event akan direkam.
          </Alert>
          {problem && (
            <Alert tone="danger" title="Assignment perlu dimuat ulang">
              {problem}
            </Alert>
          )}
        </Sheet>
      )}
    </div>
  );
}

type Assignment = Awaited<ReturnType<typeof supplierApi.defaultAssignments>>['mps'][number];
type Member = Awaited<ReturnType<typeof supplierApi.members>>['items'][number];

function AssignmentSummary({
  label,
  assignment,
  memberMap,
  onEdit,
}: {
  label: string;
  assignment: Assignment | undefined;
  memberMap: Map<string, Member>;
  onEdit: (assignment: Assignment | undefined, trigger: HTMLElement) => void;
}) {
  const member = assignment ? memberMap.get(assignment.memberId) : undefined;
  return (
    <div className="defaults-summary__person">
      <span>{label}</span>
      <Person member={member} />
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<UserPlus />}
        onClick={(event) => onEdit(assignment, event.currentTarget)}
      >
        {assignment ? 'Ganti' : 'Assign'}
      </Button>
    </div>
  );
}

function Person({ member }: { member: Member | undefined }) {
  if (!member) return <span className="person-empty">Belum assigned</span>;
  return (
    <span className="person-summary">
      <i>{member.initials}</i>
      <span>
        <strong>{member.fullName}</strong>
        <small>{member.registrationNumber}</small>
      </span>
    </span>
  );
}

function FieldSelect({
  kind,
  value,
  members,
  onChange,
}: {
  kind: AssignmentKind;
  value: string;
  members: Member[];
  onChange: (value: string) => void;
}) {
  const role = kind === 'supervisor' ? 'SUPERVISOR' : kind === 'leader' ? 'LINE_LEADER' : 'MP';
  return (
    <label className="sheet-field">
      <span>Member tersedia</span>
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Pilih member</option>
        {members
          .filter((member) => member.role === role)
          .map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName} · {member.registrationNumber}
            </option>
          ))}
      </NativeSelect>
    </label>
  );
}
