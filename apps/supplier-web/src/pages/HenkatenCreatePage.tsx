import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import type { CreateHenkatenRequest, HenkatenCategory } from '@tmmin-henkaten/contracts';
import { Alert, Button, Field, Input, NativeSelect, Panel, Textarea } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { ChecklistResponseList, HenkatenCategoryPicker, SelectedPart } from './HenkatenWorkflow';

export function HenkatenCreatePage({ clone = false }: { clone?: boolean }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const { henkatenId } = useParams();
  const [params] = useSearchParams();
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const [category, setCategory] = useState<HenkatenCategory>('MAN');
  const [lineShiftId, setLineShiftId] = useState(params.get('lineShiftId') ?? '');
  const [jobId, setJobId] = useState(params.get('jobId') ?? '');
  const [partId, setPartId] = useState('');
  const [partSearch, setPartSearch] = useState('');
  const [replacementMpId, setReplacementMpId] = useState('');
  const [cause, setCause] = useState('');
  const [detail, setDetail] = useState('');
  const [affectedObject, setAffectedObject] = useState('');
  const [replacementObject, setReplacementObject] = useState('');
  const [answers, setAnswers] = useState<Record<string, 'YES' | 'NO'>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [intentKey, setIntentKey] = useState(() => createIdempotencyKey());
  const context = useQuery({
    queryKey: scopedKey(scope, 'line-shift-operational-context'),
    queryFn: () => supplierApi.lineShiftOperationalContext(),
  });
  const clonePrefill = useQuery({
    queryKey: scopedKey(scope, 'henkaten-clone-prefill', henkatenId),
    queryFn: () => supplierApi.clonePrefill(henkatenId!),
    enabled: clone && Boolean(henkatenId),
  });
  const options = useQuery({
    queryKey: scopedKey(scope, 'henkaten-form-options', { category, partSearch }),
    queryFn: () =>
      supplierApi.henkatenFormOptions({
        category,
        ...(partSearch.trim() ? { part: partSearch.trim() } : {}),
      }),
  });
  useEffect(() => {
    const currentIds = context.data?.currentLineShiftIds ?? [];
    if (currentIds.length > 0 && !currentIds.includes(lineShiftId)) {
      setLineShiftId(currentIds[0]!);
      setJobId('');
    }
  }, [context.data?.currentLineShiftIds, lineShiftId]);
  useEffect(() => {
    setAnswers({});
    setReplacementMpId('');
  }, [category]);
  useEffect(() => {
    const prefill = clonePrefill.data;
    if (!prefill) return;
    setCategory(prefill.category);
    setJobId(prefill.jobStillValid ? prefill.jobId : '');
    setPartId(prefill.partStillValid ? prefill.partId : '');
    setCause(prefill.cause);
    setDetail(prefill.detail);
    setAffectedObject(prefill.affectedObject ?? '');
    setReplacementObject(prefill.replacementObject ?? '');
  }, [clonePrefill.data]);
  const selectedShift = context.data?.items.find(({ id }) => id === lineShiftId);
  const selectedAssignment = selectedShift?.assignments.find(({ jobId: id }) => id === jobId);
  const selectedPart = options.data?.parts.find(({ id }) => id === partId);
  const replacement = options.data?.replacementMembers.find(({ id }) => id === replacementMpId);
  const tanoko = replacement?.skillLevels?.find(({ jobId: id }) => id === jobId)?.level ?? 0;
  const checklist = options.data?.checklist;
  const checklistComplete =
    Boolean(checklist?.items.length) && checklist!.items.every(({ id }) => answers[id] === 'YES');
  const categoryComplete =
    category === 'MAN'
      ? Boolean(selectedAssignment && replacement && tanoko >= 3)
      : Boolean(affectedObject.trim() && replacementObject.trim());
  const valid = Boolean(
    selectedShift &&
    jobId &&
    partId &&
    cause.trim() &&
    detail.trim() &&
    categoryComplete &&
    checklistComplete,
  );
  const selectableShifts = useMemo(() => {
    const items = context.data?.items ?? [];
    const currentIds = context.data?.currentLineShiftIds ?? [];
    return currentIds.length ? items.filter(({ id }) => currentIds.includes(id)) : items;
  }, [context.data]);
  const submit = useMutation({
    mutationFn: () => {
      const base = {
        lineShiftId,
        jobId,
        partId,
        checklistVersionId: checklist!.id,
        checklistAnswers: checklist!.items.map(({ id }) => ({ itemId: id, answer: answers[id]! })),
        cause,
        detail,
        ...(clone && henkatenId ? { clonedFromHenkatenId: henkatenId } : {}),
      };
      const body: CreateHenkatenRequest =
        category === 'MAN'
          ? {
              ...base,
              category,
              lineShiftJobAssignmentId: selectedAssignment!.id,
              replacementMpMemberId: replacementMpId,
            }
          : { ...base, category, affectedObject, replacementObject };
      return supplierApi.createHenkaten(body, intentKey);
    },
    onSuccess: (created) => navigate(`/henkatens/${created.id}`, { replace: true }),
    onError: (error) => {
      setProblem(
        error instanceof ApiProblemError ? error.problem.detail : 'Henkaten tidak dapat disimpan.',
      );
      setIntentKey(createIdempotencyKey());
      void context.refetch();
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
        eyebrow="Henkaten"
        title={clone ? 'Clone Henkaten' : 'Buat Henkaten'}
        description=""
      />
      {problem && (
        <Alert tone="danger" title="Submission gagal">
          {problem}
        </Alert>
      )}
      {!context.isLoading && selectableShifts.length === 0 && (
        <Alert tone="danger" title="Line shift tidak tersedia">
          Hubungi Supplier Admin.
        </Alert>
      )}
      <form onSubmit={send} className="henkaten-form">
        <div className="henkaten-form__main">
          <Panel title="Kategori">
            <HenkatenCategoryPicker value={category} onChange={setCategory} />
          </Panel>
          <Panel title="Line dan shift">
            <Field label="Line · Shift" htmlFor="line-shift" required>
              <NativeSelect
                id="line-shift"
                value={lineShiftId}
                disabled={
                  selectableShifts.length === 1 && Boolean(context.data?.currentLineShiftId)
                }
                onChange={(event) => {
                  setLineShiftId(event.target.value);
                  setJobId('');
                }}
              >
                <option value="">Pilih line dan shift</option>
                {selectableShifts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.lineCode} · {item.lineName} · {item.shiftName} · {item.startTime}–
                    {item.endTime}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {selectedShift && (
              <div className="defaults-summary">
                <span>
                  <strong>{selectedShift.current ? 'Sedang berjalan' : 'Shift berikutnya'}</strong>
                  <small>
                    {formatDateTime(selectedShift.effectiveStartAt)} –{' '}
                    {formatDateTime(selectedShift.effectiveEndAt)}
                  </small>
                </span>
              </div>
            )}
            <Field label="Job" htmlFor="job" required>
              <NativeSelect
                id="job"
                value={jobId}
                disabled={!selectedShift}
                onChange={(event) => {
                  setJobId(event.target.value);
                  setReplacementMpId('');
                }}
              >
                <option value="">Pilih job</option>
                {selectedShift?.assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.jobId}>
                    {assignment.jobName} · {assignment.mpName ?? 'Belum ada MP'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Cari part" htmlFor="part-search">
              <Input
                id="part-search"
                value={partSearch}
                onChange={(event) => {
                  setPartSearch(event.target.value);
                  setPartId('');
                }}
              />
            </Field>
            <Field label="Part" htmlFor="part" required>
              <NativeSelect
                id="part"
                value={partId}
                onChange={(event) => setPartId(event.target.value)}
              >
                <option value="">Pilih part</option>
                {options.data?.parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.partNumber} · {part.partName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <SelectedPart part={selectedPart} onClear={() => setPartId('')} />
          </Panel>
          {category === 'MAN' ? (
            <Panel title="Replacement MP">
              <Field label="MP pengganti" htmlFor="replacement" required>
                <NativeSelect
                  id="replacement"
                  value={replacementMpId}
                  disabled={!jobId}
                  onChange={(event) => setReplacementMpId(event.target.value)}
                >
                  <option value="">Pilih MP</option>
                  {options.data?.replacementMembers.map((member) => {
                    const level =
                      member.skillLevels?.find(({ jobId: id }) => id === jobId)?.level ?? 0;
                    return (
                      <option key={member.id} value={member.id} disabled={level < 3}>
                        {member.fullName} · {member.registrationNumber} · Tanoko {level || '—'}
                      </option>
                    );
                  })}
                </NativeSelect>
              </Field>
              {replacementMpId && tanoko < 3 && (
                <Alert tone="danger" title="Tanoko belum memenuhi">
                  Minimal level 3.
                </Alert>
              )}
            </Panel>
          ) : (
            <Panel title="Perubahan objek">
              <Field label="Objek terdampak" htmlFor="affected" required>
                <Textarea
                  id="affected"
                  value={affectedObject}
                  maxLength={2000}
                  onChange={(event) => setAffectedObject(event.target.value)}
                />
              </Field>
              <Field label="Kondisi baru" htmlFor="replacement-object" required>
                <Textarea
                  id="replacement-object"
                  value={replacementObject}
                  maxLength={2000}
                  onChange={(event) => setReplacementObject(event.target.value)}
                />
              </Field>
            </Panel>
          )}
          <Panel title="Detail">
            <Field label="Penyebab" htmlFor="cause" required>
              <Textarea
                id="cause"
                value={cause}
                maxLength={2000}
                onChange={(event) => setCause(event.target.value)}
              />
            </Field>
            <Field label="Detail kejadian" htmlFor="detail" required>
              <Textarea
                id="detail"
                value={detail}
                maxLength={2000}
                onChange={(event) => setDetail(event.target.value)}
              />
            </Field>
          </Panel>
          <Panel title="Checklist">
            {checklist?.items.length ? (
              <ChecklistResponseList
                items={checklist.items}
                answers={answers}
                onChange={(itemId, answer) =>
                  setAnswers((current) => ({ ...current, [itemId]: answer }))
                }
              />
            ) : (
              <Alert tone="danger" title="Checklist belum tersedia">
                Hubungi Supplier Admin.
              </Alert>
            )}
          </Panel>
        </div>
        <aside className="henkaten-review" aria-label="Ringkasan Henkaten">
          <h2>Ringkasan</h2>
          <dl>
            <div>
              <dt>Kategori</dt>
              <dd>{category}</dd>
            </div>
            <div>
              <dt>Line</dt>
              <dd>{selectedShift?.lineName ?? '—'}</dd>
            </div>
            <div>
              <dt>Shift</dt>
              <dd>{selectedShift?.shiftName ?? '—'}</dd>
            </div>
            <div>
              <dt>Job</dt>
              <dd>{selectedAssignment?.jobName ?? '—'}</dd>
            </div>
            <div>
              <dt>Part</dt>
              <dd>{selectedPart?.partNumber ?? '—'}</dd>
            </div>
          </dl>
          <Button type="submit" loading={submit.isPending} disabled={!valid}>
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
