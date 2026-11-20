import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiProblemError, createIdempotencyKey } from '@tmmin-henkaten/api-client';
import {
  MAX_HENKATEN_PARTS,
  type CreateHenkatenRequest,
  type HenkatenCategory,
} from '@tmmin-henkaten/contracts';
import { Alert, Button, Field, Panel, Select, Textarea } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { HenkatenPartPicker, type PartChoice, type PartSelection } from './HenkatenPartPicker';
import { ChecklistResponseList, HenkatenCategoryPicker } from './HenkatenWorkflow';

// Page size of the catalog search behind the part picker.
const PART_RESULT_LIMIT = 50;

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
  const [jobId, setJobId] = useState(params.get('jobId') ?? '');
  const [lineShiftId, setLineShiftId] = useState(params.get('lineShiftId') ?? '');
  const [partSelection, setPartSelection] = useState<PartSelection>({ parts: [], other: false });
  const [partResults, setPartResults] = useState<readonly PartChoice[]>([]);
  const [clonePartsDropped, setClonePartsDropped] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [replacementMpId, setReplacementMpId] = useState('');
  const [cause, setCause] = useState('');
  const [detail, setDetail] = useState('');
  const [affectedObject, setAffectedObject] = useState('');
  const [replacementObject, setReplacementObject] = useState('');
  const [answers, setAnswers] = useState<Record<string, 'YES' | 'NO'>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [submittedIntent, setSubmittedIntent] = useState<{
    body: CreateHenkatenRequest;
    key: string;
  } | null>(null);
  const [intentKey, setIntentKey] = useState(() => createIdempotencyKey());
  const context = useQuery({
    queryKey: scopedKey(scope, 'line-shift-operational-context'),
    queryFn: () => supplierApi.lineShiftOperationalContext(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
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
  // Keep the last result page visible while the next search is loading.
  useEffect(() => {
    if (options.data) setPartResults(options.data.parts);
  }, [options.data]);
  const [displayedChecklist, setDisplayedChecklist] = useState<{
    category: HenkatenCategory;
    checklist: NonNullable<typeof options.data>['checklist'];
  }>();
  useEffect(() => {
    if (options.data && displayedChecklist?.category !== category) {
      setDisplayedChecklist({ category, checklist: options.data.checklist });
    }
  }, [category, options.data, displayedChecklist]);
  useEffect(() => {
    setAnswers({});
    setReplacementMpId('');
  }, [category]);
  useEffect(() => {
    const prefill = clonePrefill.data;
    if (!prefill) return;
    setCategory(prefill.category);
    if (prefill.lineShiftId) setLineShiftId(prefill.lineShiftId);
    setJobId(prefill.jobStillValid ? prefill.jobId : '');
    setPartSelection({ parts: prefill.parts, other: prefill.partId === null });
    setClonePartsDropped(!prefill.partStillValid);
    setCause(prefill.cause);
    setDetail(prefill.detail);
    setAffectedObject(prefill.affectedObject ?? '');
    setReplacementObject(prefill.replacementObject ?? '');
  }, [clonePrefill.data]);
  const [shownContext, setShownContext] = useState<typeof context.data>();
  const shiftItems = shownContext?.items ?? [];
  // One Line–Shift, or a single current one, is chosen automatically.
  const defaultShiftId =
    shiftItems.length === 1
      ? shiftItems[0]!.id
      : shownContext?.currentLineShiftIds.length === 1
        ? shownContext.currentLineShiftIds[0]!
        : '';
  const effectiveShiftId = lineShiftId || defaultShiftId;
  const selectedShift = shiftItems.find(({ id }) => id === effectiveShiftId);
  const formDirty = Boolean(
    jobId ||
    partSelection.other ||
    partSelection.parts.length > 0 ||
    replacementMpId ||
    cause.trim() ||
    detail.trim() ||
    affectedObject.trim() ||
    replacementObject.trim() ||
    Object.keys(answers).length > 0 ||
    (lineShiftId && lineShiftId !== defaultShiftId),
  );
  const contextChanged = Boolean(
    shownContext &&
    context.data &&
    contextSignature(shownContext) !== contextSignature(context.data),
  );
  // Keep a clean form synced with schedule changes; once edited, prompt before refreshing.
  useEffect(() => {
    if (!context.data || submittedIntent) return;
    if (!shownContext || !selectedShift || !formDirty) setShownContext(context.data);
  }, [shownContext, selectedShift, formDirty, submittedIntent, context.data]);
  useEffect(() => {
    if (
      selectedShift &&
      jobId &&
      !selectedShift.assignments.some(({ jobId: id }) => id === jobId)
    ) {
      setJobId('');
    }
  }, [selectedShift, jobId]);
  const selectedAssignment = selectedShift?.assignments.find(({ jobId: id }) => id === jobId);
  const partChosen = partSelection.other || partSelection.parts.length > 0;
  const replacement = options.data?.replacementMembers.find(({ id }) => id === replacementMpId);
  const tanoko = replacement?.skillLevels?.find(({ jobId: id }) => id === jobId)?.level ?? 0;
  const checklist =
    displayedChecklist?.category === category ? displayedChecklist.checklist : undefined;
  const categoryComplete =
    category === 'MAN'
      ? Boolean(selectedAssignment && replacement && tanoko >= 3)
      : Boolean(affectedObject.trim() && replacementObject.trim());
  const valid = Boolean(
    selectedShift &&
    jobId &&
    partChosen &&
    cause.trim() &&
    detail.trim() &&
    categoryComplete &&
    options.isSuccess &&
    displayedChecklist?.category === category,
  );
  const submit = useMutation({
    mutationFn: () => {
      if (submittedIntent)
        return supplierApi.createHenkaten(submittedIntent.body, submittedIntent.key);
      const base = {
        lineShiftId: selectedShift!.id,
        expectedEffectiveStartAt: selectedShift!.effectiveStartAt,
        expectedLineShiftVersion: selectedShift!.version,
        jobId,
        ...(partSelection.other
          ? { otherPart: true as const }
          : { partIds: partSelection.parts.map(({ id }) => id) }),
        ...(checklist
          ? {
              checklistVersionId: checklist.id,
              checklistAnswers: checklist.items.flatMap(({ id }) =>
                answers[id] ? [{ itemId: id, answer: answers[id] }] : [],
              ),
            }
          : {}),
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
              expectedReplacedMpMemberId: selectedAssignment!.mpMemberId,
            }
          : { ...base, category, affectedObject, replacementObject };
      setSubmittedIntent({ body, key: intentKey });
      return supplierApi.createHenkaten(body, intentKey);
    },
    onSuccess: (created) =>
      navigate(`/henkatens/${created.id}/assessment`, {
        replace: true,
        state: { submittedHenkatenId: created.id },
      }),
    onError: (error) => {
      setProblem(
        error instanceof ApiProblemError ? error.problem.detail : 'Henkaten tidak dapat disimpan.',
      );
      if (
        error instanceof ApiProblemError &&
        error.problem.status < 500 &&
        error.problem.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        setSubmittedIntent(null);
        setIntentKey(createIdempotencyKey());
        void context.refetch().then(({ data }) => setShownContext(data));
      }
    },
  });
  const send = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (submittedIntent || valid) submit.mutate();
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
      {contextChanged && !submittedIntent && (
        <Alert tone="warning" title="Jadwal atau assignment shift berubah">
          Perbarui konteks shift sebelum mengirim. Isian form tetap tersimpan.
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!context.data) return;
              setShownContext(context.data);
              setProblem(null);
            }}
          >
            Perbarui jadwal
          </Button>
        </Alert>
      )}
      {!context.isLoading && !shiftItems.length && (
        <Alert tone="danger" title="Line shift tidak tersedia">
          Line Leader belum ditugaskan pada Line–Shift aktif. Hubungi Supplier Admin.
        </Alert>
      )}
      <form onSubmit={send} className="henkaten-form">
        <fieldset
          className="henkaten-form__main"
          disabled={Boolean(submittedIntent)}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <Panel title="Kategori">
            <HenkatenCategoryPicker value={category} onChange={setCategory} />
          </Panel>
          <Panel title="Line dan shift">
            {shiftItems.length > 1 && (
              <div
                className="henkaten-shift-options"
                role="radiogroup"
                aria-label="Pilih Line–Shift"
                data-focus-target="line-shift"
              >
                {shiftItems.map((item) => {
                  const checked = item.id === effectiveShiftId;
                  return (
                    <label
                      key={item.id}
                      className={`henkaten-shift-option${checked ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="line-shift"
                        value={item.id}
                        checked={checked}
                        onChange={() => setLineShiftId(item.id)}
                      />
                      <span className="henkaten-shift-option__body">
                        <span className="henkaten-shift-option__top">
                          <strong>
                            {item.lineCode} · {item.lineName}
                          </strong>
                          <span className={item.current ? 'is-current' : 'is-next'}>
                            {item.current ? 'Sedang berlangsung' : 'Shift berikutnya'}
                          </span>
                        </span>
                        <span>
                          {item.shiftName} · {item.startTime}–{item.endTime}
                          {item.crossesMidnight ? ' (hari berikutnya)' : ''}
                        </span>
                        <small>
                          {item.current ? 'Berlaku hingga ' : 'Berlaku mulai '}
                          {formatDateTime(
                            item.current ? item.effectiveEndAt : item.effectiveStartAt,
                          )}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {shiftItems.length === 1 && selectedShift && (
              <div className="henkaten-assigned-shift" aria-live="polite">
                <div className="henkaten-assigned-shift__top">
                  <span className="henkaten-assigned-shift__eyebrow">Assignment Anda</span>
                  <span className={selectedShift.current ? 'is-current' : 'is-next'}>
                    {selectedShift.current ? 'Sedang berlangsung' : 'Shift berikutnya'}
                  </span>
                </div>
                <strong>
                  {selectedShift.lineCode} · {selectedShift.lineName}
                </strong>
                <span>
                  {selectedShift.shiftName} · {selectedShift.startTime}–{selectedShift.endTime}
                  {selectedShift.crossesMidnight ? ' (hari berikutnya)' : ''}
                </span>
                <small>
                  {selectedShift.current ? 'Berlaku hingga ' : 'Berlaku mulai '}
                  {formatDateTime(
                    selectedShift.current
                      ? selectedShift.effectiveEndAt
                      : selectedShift.effectiveStartAt,
                  )}
                  {' · '}Tanggal operasional {selectedShift.businessDate}
                </small>
              </div>
            )}
            <Field label="Job" htmlFor="job" required>
              <Select
                id="job"
                value={jobId}
                disabled={!selectedShift}
                placeholder="Pilih job"
                searchPlaceholder="Cari job atau MP…"
                onValueChange={(next) => {
                  setJobId(next);
                  setReplacementMpId('');
                }}
                options={(selectedShift?.assignments ?? []).map((assignment) => ({
                  value: assignment.jobId,
                  label: assignment.jobName,
                  description: assignment.mpName ?? 'Belum ada MP',
                }))}
              />
            </Field>
            <Field label="Part" htmlFor="part" required>
              <HenkatenPartPicker
                id="part"
                value={partSelection}
                onChange={(next) => {
                  setPartSelection(next);
                  setClonePartsDropped(false);
                }}
                results={partResults}
                resultLimit={PART_RESULT_LIMIT}
                loading={options.isFetching}
                onSearch={setPartSearch}
                max={MAX_HENKATEN_PARTS}
              />
            </Field>
            {clonePartsDropped && (
              <Alert tone="warning" title="Part perlu diperiksa">
                Sebagian part dari Henkaten asal sudah tidak aktif.
              </Alert>
            )}
          </Panel>
          {category === 'MAN' ? (
            <Panel title="Replacement MP">
              <Field label="MP pengganti" htmlFor="replacement" required>
                <Select
                  id="replacement"
                  value={replacementMpId}
                  disabled={!jobId}
                  placeholder="Pilih MP"
                  searchPlaceholder="Cari nama MP…"
                  onValueChange={setReplacementMpId}
                  options={(options.data?.replacementMembers ?? []).map((member) => {
                    const level =
                      member.skillLevels?.find(({ jobId: id }) => id === jobId)?.level ?? 0;
                    return {
                      value: member.id,
                      label: member.fullName,
                      meta: `Tanoko ${level || '—'}`,
                      disabled: level < 3,
                    };
                  })}
                />
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
          <Panel title="Checklist 4M (opsional)">
            {checklist?.items.length ? (
              <ChecklistResponseList
                items={checklist.items}
                answers={answers}
                onChange={(itemId, answer) =>
                  setAnswers((current) => {
                    const next = { ...current };
                    if (answer) next[itemId] = answer;
                    else delete next[itemId];
                    return next;
                  })
                }
              />
            ) : (
              <p>Belum ada item checklist.</p>
            )}
          </Panel>
        </fieldset>
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
              <dd>
                {partSelection.other ? (
                  'Other'
                ) : partSelection.parts.length ? (
                  <ul className="henkaten-review__parts">
                    {partSelection.parts.map((part) => (
                      <li key={part.id}>{part.partNumber}</li>
                    ))}
                  </ul>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          <Button type="submit" loading={submit.isPending} disabled={!submittedIntent && !valid}>
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

function contextSignature(
  data: Awaited<ReturnType<typeof supplierApi.lineShiftOperationalContext>> | undefined,
) {
  if (!data) return '';
  return JSON.stringify(
    data.items.map((item) => ({
      id: item.id,
      version: item.version,
      shiftName: item.shiftName,
      startTime: item.startTime,
      endTime: item.endTime,
      current: item.current,
      businessDate: item.businessDate,
      effectiveStartAt: item.effectiveStartAt,
      effectiveEndAt: item.effectiveEndAt,
      assignments: item.assignments.map((assignment) => [
        assignment.id,
        assignment.jobId,
        assignment.mpMemberId ?? '',
      ]),
    })),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
