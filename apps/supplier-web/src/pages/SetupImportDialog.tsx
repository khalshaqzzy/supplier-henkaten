import {
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiContractError,
  ApiMutationUncertainError,
  ApiProblemError,
  createIdempotencyKey,
} from '@tmmin-henkaten/api-client';
import {
  SETUP_SHEETS,
  setupRowKey,
  type SetupCommit,
  type SetupDecision,
  type SetupIssue,
  type SetupOperation,
  type SetupPreview,
  type SetupRow,
  type SetupSheet,
} from '@tmmin-henkaten/contracts';
import { Alert, Button, Dialog, NativeSelect, Skeleton, toast } from '@tmmin-henkaten/ui';
import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import type { ParsedSetupWorkbook } from './setupWorkbook';
import './setup-import.css';

export const setupErrorMessage = (error: unknown) =>
  error instanceof ApiProblemError
    ? error.problem.detail
    : error instanceof Error
      ? error.message
      : 'Tidak dapat memproses setup. Coba lagi.';
export const setupResultUncertain = (error: unknown) =>
  error instanceof ApiMutationUncertainError ||
  error instanceof ApiContractError ||
  (error instanceof ApiProblemError && error.problem.status >= 500);
export function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SetupImportDialog() {
  const { session } = useSession();
  const client = useQueryClient();
  const storageKey = `setup-import:${session!.supplier!.id}:${session!.principal.userId}`;
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [rows, setRows] = useState<SetupRow[]>([]);
  const [localIssues, setLocalIssues] = useState<SetupIssue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, SetupDecision['action']>>({});
  const [sheet, setSheet] = useState<SetupSheet>('Member');
  const [page, setPage] = useState(0);
  const [stage, setStage] = useState<'READING' | 'VALIDATING' | 'MATCHING' | 'SUBMITTING' | null>(
    null,
  );
  const [operation, setOperation] = useState<SetupOperation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const retry = useRef<{ body: SetupCommit; key: string } | null>(null);
  const reported = useRef<string | null>(null);
  const processing = operation?.status === 'QUEUED' || operation?.status === 'RUNNING';
  const locked = Boolean(stage || processing || uncertain);
  const available = SETUP_SHEETS.filter((spec) => rows.some((r) => r.sheet === spec.name));
  const accountIssues: SetupIssue[] = (preview?.rows ?? []).flatMap((diff) => {
    if (diff.sheet !== 'Member' || diff.status !== 'NEW') return [];
    const row = rows.find((r) => r.sheet === 'Member' && r.sourceRow === diff.sourceRow);
    const length = row?.data['password']?.length ?? 0;
    return row && row.data['role'] !== 'MP' && (length < 12 || length > 128)
      ? [
          {
            sheet: 'Member',
            sourceRow: row.sourceRow,
            column: 'Password awal',
            message: 'Akun baru memerlukan password awal 12–128 karakter.',
          },
        ]
      : [];
  });
  const allIssues = [...localIssues, ...(preview?.issues ?? []), ...accountIssues];
  const diffs = preview?.rows.filter((r) => r.sheet === sheet) ?? [];
  const interesting = diffs.filter((r) => r.status !== 'SAME');
  const shown = interesting.slice(page * 50, (page + 1) * 50);
  const unresolved =
    preview?.rows.filter((r) => ['CHANGED', 'INACTIVE'].includes(r.status) && !choices[r.key])
      .length ?? 0;
  const changeCount =
    preview?.rows.filter(
      (r) => r.status === 'NEW' || choices[r.key] === 'UPDATE' || choices[r.key] === 'RESTORE',
    ).length ?? 0;
  const metrics = [
    ['Baru', preview?.rows.filter((r) => r.status === 'NEW').length ?? rows.length],
    [
      'Berubah',
      preview?.rows.filter((r) => r.status === 'CHANGED' || r.status === 'INACTIVE').length ?? 0,
    ],
    ['Sesuai', preview?.rows.filter((r) => r.status === 'SAME').length ?? 0],
    ['Error', allIssues.length],
  ] as const;

  useEffect(
    () => () => {
      worker.current?.terminate();
      sequence.current++;
      retry.current = null;
    },
    [],
  );
  useEffect(() => {
    const id = sessionStorage.getItem(storageKey);
    if (!id) return;
    let alive = true;
    void supplierApi
      .setupOperation(id)
      .then((result) => {
        if (alive) setOperation(result);
      })
      .catch(() => {
        sessionStorage.removeItem(storageKey);
      });
    return () => {
      alive = false;
    };
  }, [storageKey]);
  useEffect(() => {
    if (!processing || !operation) return;
    let alive = true;
    const refresh = () =>
      void supplierApi
        .setupOperation(operation.id)
        .then((result) => {
          if (alive) {
            setOperation(result);
            setProblem(null);
          }
        })
        .catch(() => {
          if (alive) setProblem('Status import belum dapat dimuat. Memeriksa kembali…');
        });
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [operation?.id, processing]);
  useEffect(() => {
    if (!operation || processing || reported.current === operation.id) return;
    reported.current = operation.id;
    sessionStorage.removeItem(storageKey);
    if (operation.status === 'COMPLETED') {
      void client.invalidateQueries();
      toast.success('Import data selesai');
    }
  }, [operation, processing, client, storageKey]);

  const clearFile = () => {
    sequence.current++;
    worker.current?.terminate();
    worker.current = null;
    setFile(null);
    setRows([]);
    setLocalIssues([]);
    setWarnings([]);
    setPreview(null);
    setChoices({});
    setOperation(null);
    setProblem(null);
    setStage(null);
    setPage(0);
    setHighlight(null);
    setIssuesOpen(false);
    retry.current = null;
    setUncertain(false);
    if (input.current) input.current.value = '';
  };
  const changeOpen = (next: boolean) => {
    if (!next && (uncertain || stage === 'SUBMITTING')) return;
    if (!next && rows.length && !processing && !operation) {
      setDiscard(true);
      return;
    }
    if (!next && !processing) clearFile();
    setOpen(next);
  };
  const review = async (
    source: SetupRow[],
    decisions: Record<string, SetupDecision['action']> = {},
  ) => {
    const token = ++sequence.current;
    setStage('MATCHING');
    setProblem(null);
    try {
      const next = await supplierApi.previewSetupImport(
        source,
        Object.entries(decisions).map(([key, action]) => ({ key, action })),
      );
      if (token === sequence.current) {
        setPreview(next);
        setStage(null);
      }
    } catch (error) {
      if (token === sequence.current) {
        setProblem(setupErrorMessage(error));
        setStage(null);
      }
    }
  };
  const selectFile = (selected: File | undefined) => {
    if (!selected || locked) return;
    clearFile();
    setFile({ name: selected.name, size: selected.size });
    setStage('READING');
    const token = sequence.current;
    const reader = new Worker(new URL('./setupWorkbook.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = reader;
    reader.onmessage = (
      event: MessageEvent<{
        stage?: 'READING' | 'VALIDATING';
        error?: string;
        result?: ParsedSetupWorkbook;
      }>,
    ) => {
      if (token !== sequence.current) return;
      if (event.data.error) {
        setProblem(event.data.error);
        setStage(null);
        reader.terminate();
      } else if (event.data.result) {
        const result = event.data.result;
        setRows(result.rows);
        setLocalIssues(result.issues);
        setWarnings(result.warnings);
        setSheet(result.rows[0]!.sheet);
        setStage(null);
        reader.terminate();
        if (!result.issues.length) void review(result.rows);
        else setIssuesOpen(true);
      } else if (event.data.stage) setStage(event.data.stage);
    };
    reader.onerror = () => {
      if (token === sequence.current) {
        setStage(null);
        setProblem('File tidak dapat dibaca. Simpan ulang sebagai .xlsx.');
      }
      reader.terminate();
    };
    reader.postMessage(selected);
  };
  const choose = (key: string, action: SetupDecision['action']) => {
    const next = { ...choices, [key]: action };
    setChoices(next);
    void review(rows, next);
  };
  const bulk = (action: SetupDecision['action']) => {
    const next = { ...choices };
    diffs
      .filter((r) => r.status === 'CHANGED' || (r.status === 'INACTIVE' && action === 'SKIP'))
      .forEach((r) => {
        next[r.key] = action;
      });
    setChoices(next);
    void review(rows, next);
  };
  const linkMember = (row: SetupRow, targetId: string) => {
    const next = rows.map((r) => {
      if (r !== row) return r;
      const { targetId: previousTarget, ...rest } = r;
      void previousTarget;
      return targetId ? { ...rest, targetId } : rest;
    });
    setRows(next);
    const nextChoices = { ...choices };
    delete nextChoices[setupRowKey(row)];
    setChoices(nextChoices);
    void review(next, nextChoices);
  };
  const submit = async () => {
    if (!retry.current) {
      if (!preview) return;
      retry.current = {
        body: {
          rows: structuredClone(rows),
          revision: preview.revision,
          decisions: Object.entries(choices).map(([key, action]) => ({ key, action })),
        },
        key: createIdempotencyKey(),
      };
    }
    setStage('SUBMITTING');
    setProblem(null);
    try {
      const next = await supplierApi.commitSetupImport(retry.current.body, retry.current.key);
      retry.current = null;
      setUncertain(false);
      setOperation(next);
      setRows([]);
      setPreview(null);
      setChoices({});
      setWarnings([]);
      setLocalIssues([]);
      sessionStorage.setItem(storageKey, next.id);
    } catch (error) {
      setProblem(setupErrorMessage(error));
      if (setupResultUncertain(error)) setUncertain(true);
      else {
        setUncertain(false);
        retry.current = null;
      }
    } finally {
      setStage(null);
    }
  };
  const template = async () => {
    setTemplateBusy(true);
    setProblem(null);
    try {
      saveDownload(await supplierApi.setupTemplate(), 'template-setup-supplier.xlsx');
    } catch (error) {
      setProblem(setupErrorMessage(error));
    } finally {
      setTemplateBusy(false);
    }
  };
  const downloadErrors = () => {
    const cell = (s: string) => `"${(/^[=+@-]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`;
    const csv =
      '\uFEFF' +
      [
        ['Sheet', 'Baris', 'Kolom', 'Perbaikan'],
        ...allIssues.map((i) => [i.sheet, String(i.sourceRow), i.column, i.message]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\r\n');
    saveDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'error-import-setup.csv');
  };
  const statusLabel =
    stage === 'READING'
      ? 'Membaca file…'
      : stage === 'VALIDATING'
        ? 'Memeriksa sheet…'
        : stage === 'MATCHING'
          ? 'Memeriksa data…'
          : stage === 'SUBMITTING'
            ? uncertain
              ? 'Memeriksa hasil import…'
              : 'Menyiapkan import…'
            : uncertain
              ? 'Hasil import belum pasti'
              : processing
                ? operation.status === 'QUEUED'
                  ? 'Menunggu antrean…'
                  : 'Mengimport data…'
                : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={changeOpen}
        size="lg"
        className="setup-import-dialog"
        title="Import Data"
        eyebrow="Master Data"
        description=""
        trigger={
          <Button variant="primary" leadingIcon={<UploadCloud />}>
            Import Data
          </Button>
        }
        footer={
          <div className="setup-import-footer">
            <span className="setup-import-footer__status" role="status" aria-live="polite">
              {statusLabel ? (
                <>
                  <LoaderCircle className="hds-spinner" />
                  {statusLabel}
                </>
              ) : preview ? (
                `${changeCount.toLocaleString('id-ID')} data akan disimpan`
              ) : (
                '.xlsx · Maks. 50 MB'
              )}
            </span>
            <div>
              <Button
                variant="secondary"
                onClick={() => changeOpen(false)}
                disabled={uncertain || stage === 'SUBMITTING'}
              >
                {processing ? 'Tutup' : operation ? 'Selesai' : 'Batal'}
              </Button>
              {operation?.status === 'COMPLETED' ? (
                <Link
                  className="hds-button hds-button--primary hds-button--md"
                  to="/setup"
                  onClick={() => setOpen(false)}
                >
                  Lihat readiness <ChevronRight size={16} />
                </Link>
              ) : uncertain ? (
                <Button
                  variant="primary"
                  loading={stage === 'SUBMITTING'}
                  onClick={() => void submit()}
                >
                  Periksa hasil
                </Button>
              ) : operation?.status === 'FAILED' ? (
                <Button variant="primary" onClick={clearFile}>
                  Pilih file kembali
                </Button>
              ) : file && !preview && !localIssues.length && !stage ? (
                <Button variant="primary" onClick={() => void review(rows)} disabled={!rows.length}>
                  Periksa data
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={stage === 'SUBMITTING'}
                  disabled={
                    !preview ||
                    Boolean(stage) ||
                    processing ||
                    allIssues.length > 0 ||
                    unresolved > 0 ||
                    changeCount === 0
                  }
                  onClick={() => void submit()}
                >
                  Import data
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="setup-import-content" aria-busy={Boolean(stage)}>
          <div className="setup-import-steps" aria-label="Tahap import">
            {['Pilih file', 'Periksa data', 'Import', 'Hasil'].map((label, i) => {
              const step = operation ? (processing ? 2 : 3) : rows.length ? 1 : 0;
              return (
                <span
                  key={label}
                  className={i === step ? 'is-current' : i < step ? 'is-complete' : ''}
                >
                  {i < step ? <Check size={13} /> : <b>{i + 1}</b>}
                  {label}
                </span>
              );
            })}
          </div>
          {problem && (
            <Alert
              tone="danger"
              title={uncertain ? 'Memeriksa hasil import' : 'Import belum selesai'}
            >
              {problem}
            </Alert>
          )}
          {operation ? (
            <div className="setup-import-result">
              <span
                className={`setup-import-result__icon ${operation.status === 'FAILED' ? 'is-failed' : ''}`}
              >
                {processing ? (
                  <LoaderCircle className="hds-spinner" />
                ) : operation.status === 'COMPLETED' ? (
                  <CheckCircle2 />
                ) : (
                  <X />
                )}
              </span>
              <h3>
                {processing
                  ? operation.status === 'QUEUED'
                    ? 'Import dalam antrean'
                    : 'Import sedang diproses'
                  : operation.status === 'COMPLETED'
                    ? 'Data berhasil diimport'
                    : 'Import gagal'}
              </h3>
              {processing ? (
                <p>Anda dapat menutup dialog dan kembali untuk melihat hasil.</p>
              ) : operation.status === 'FAILED' ? (
                <p>{operation.error}</p>
              ) : (
                <>
                  <div className="setup-result-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Bagian</th>
                          <th>Baru</th>
                          <th>Update</th>
                          <th>Skip</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operation.result.map((r) => (
                          <tr key={r.sheet}>
                            <td>{r.sheet}</td>
                            <td>{r.created.toLocaleString('id-ID')}</td>
                            <td>{r.updated.toLocaleString('id-ID')}</td>
                            <td>{r.skipped.toLocaleString('id-ID')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>Periksa readiness. Nilai Tanoko diatur melalui halaman Tanoko.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <input
                ref={input}
                type="file"
                accept=".xlsx"
                className="setup-file-input"
                aria-label="Pilih workbook setup"
                onChange={(e) => selectFile(e.target.files?.[0])}
                disabled={locked}
              />
              {!file ? (
                <div
                  className={`setup-import-dropzone ${dragging ? 'is-dragging' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    selectFile(e.dataTransfer.files[0]);
                  }}
                >
                  <span className="setup-import-dropzone__icon">
                    <FileSpreadsheet />
                  </span>
                  <h3>Mulai dari workbook supplier</h3>
                  <p>Tarik file Excel ke sini atau pilih dari perangkat.</p>
                  <Button
                    variant="primary"
                    leadingIcon={<UploadCloud />}
                    onClick={() => input.current?.click()}
                  >
                    Pilih file Excel
                  </Button>
                  <span className="setup-import-file-hint">.xlsx · Maksimal 50 MB</span>
                  <div className="setup-import-template">
                    <span>Belum punya workbook?</span>
                    <Button
                      variant="ghost"
                      loading={templateBusy}
                      leadingIcon={<Download />}
                      onClick={() => void template()}
                    >
                      Download template
                    </Button>
                  </div>
                  <div className="setup-import-covered">
                    {SETUP_SHEETS.map((s) => (
                      <span key={s.name}>{s.name}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="setup-import-file">
                    <FileSpreadsheet />
                    <div>
                      <strong>{file.name}</strong>
                      <span>
                        {(
                          file.size / (file.size < 1024 * 1024 ? 1024 : 1024 * 1024)
                        ).toLocaleString('id-ID', {
                          maximumFractionDigits: 1,
                        })}{' '}
                        {file.size < 1024 * 1024 ? 'KB' : 'MB'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={locked}
                      leadingIcon={<RefreshCw />}
                      onClick={() => input.current?.click()}
                    >
                      Ganti file
                    </Button>
                  </div>
                  {stage === 'READING' ||
                  stage === 'VALIDATING' ||
                  (stage === 'MATCHING' && !preview) ? (
                    <div className="setup-import-loading" aria-label={statusLabel ?? 'Memuat'}>
                      <div className="setup-import-metrics">
                        {Array.from({ length: 4 }, (_, i) => (
                          <Skeleton key={i} />
                        ))}
                      </div>
                      <div className="setup-import-loading__body">
                        <Skeleton />
                        <div>
                          {Array.from({ length: 6 }, (_, i) => (
                            <Skeleton key={i} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="setup-import-metrics">
                        {metrics.map(([label, count]) => (
                          <button
                            type="button"
                            key={label}
                            className={label === 'Error' && count ? 'is-error' : ''}
                            onClick={() => {
                              if (label === 'Error' && count) setIssuesOpen(!issuesOpen);
                            }}
                            disabled={label !== 'Error' || !count}
                          >
                            <span>{label}</span>
                            <strong>{count.toLocaleString('id-ID')}</strong>
                          </button>
                        ))}
                      </div>
                      {allIssues.length > 0 && (
                        <div className="setup-import-issue-summary">
                          <span>{allIssues.length} error perlu diperbaiki</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setIssuesOpen(!issuesOpen)}
                          >
                            {issuesOpen ? 'Tutup daftar' : 'Lihat error'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={<Download />}
                            onClick={downloadErrors}
                          >
                            Download error
                          </Button>
                        </div>
                      )}
                      {issuesOpen && allIssues.length > 0 && (
                        <div className="setup-import-errors" aria-label="Error workbook">
                          {allIssues.slice(0, 200).map((issue, index) => (
                            <button
                              key={`${issue.sheet}:${issue.sourceRow}:${issue.column}:${index}`}
                              type="button"
                              onClick={() => {
                                setSheet(issue.sheet);
                                const changes = preview?.rows.filter(
                                  (row) => row.sheet === issue.sheet && row.status !== 'SAME',
                                );
                                const index =
                                  changes?.findIndex((row) => row.sourceRow === issue.sourceRow) ??
                                  rows
                                    .filter((row) => row.sheet === issue.sheet)
                                    .findIndex((row) => row.sourceRow === issue.sourceRow);
                                setPage(Math.floor(Math.max(0, index) / (changes ? 50 : 10)));
                                setHighlight(issue.sourceRow);
                              }}
                            >
                              <strong>
                                {issue.sheet}{' '}
                                <span>
                                  · Baris {issue.sourceRow} · {issue.column}
                                </span>
                              </strong>
                              <span>{issue.message}</span>
                            </button>
                          ))}
                          {allIssues.length > 200 && (
                            <p>Download error untuk melihat seluruh daftar.</p>
                          )}
                        </div>
                      )}
                      {available.length > 0 && (
                        <div className="setup-import-workspace">
                          <nav className="setup-import-sheet-rail" aria-label="Sheet workbook">
                            {available.map((spec) => {
                              const errorCount = allIssues.filter(
                                (i) => i.sheet === spec.name,
                              ).length;
                              return (
                                <button
                                  type="button"
                                  className={sheet === spec.name ? 'is-current' : ''}
                                  key={spec.name}
                                  onClick={() => {
                                    setSheet(spec.name);
                                    setPage(0);
                                    setHighlight(null);
                                  }}
                                >
                                  <span>{spec.name}</span>
                                  <small className={errorCount ? 'is-error' : ''}>
                                    {errorCount
                                      ? `${errorCount} error`
                                      : rows
                                          .filter((r) => r.sheet === spec.name)
                                          .length.toLocaleString('id-ID')}
                                  </small>
                                </button>
                              );
                            })}
                          </nav>
                          <div className="setup-import-review">
                            <label className="setup-import-sheet-select">
                              <span>Sheet</span>
                              <NativeSelect
                                value={sheet}
                                onChange={(e) => {
                                  setSheet(e.target.value as SetupSheet);
                                  setPage(0);
                                }}
                              >
                                {available.map((s) => (
                                  <option key={s.name}>{s.name}</option>
                                ))}
                              </NativeSelect>
                            </label>
                            <div className="setup-import-review__header">
                              <div>
                                <h3>{sheet}</h3>
                                <span>
                                  {diffs.length
                                    ? `${diffs.length.toLocaleString('id-ID')} data · ${diffs.filter((r) => r.status === 'SAME').length.toLocaleString('id-ID')} sesuai`
                                    : `${rows.filter((r) => r.sheet === sheet).length.toLocaleString('id-ID')} baris`}
                                </span>
                              </div>
                              {diffs.some(
                                (r) => r.status === 'CHANGED' || r.status === 'INACTIVE',
                              ) && (
                                <div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={locked}
                                    onClick={() => bulk('SKIP')}
                                  >
                                    Skip semua
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={locked}
                                    onClick={() => bulk('UPDATE')}
                                  >
                                    Update semua
                                  </Button>
                                </div>
                              )}
                            </div>
                            {shown.length ? (
                              <div className="setup-import-diff-list">
                                {shown.map((diff) => (
                                  <article
                                    className={`setup-import-diff ${highlight === diff.sourceRow ? 'is-highlighted' : ''}`}
                                    key={diff.key}
                                  >
                                    <div className="setup-import-diff__identity">
                                      <div>
                                        <strong>{diff.label || `Baris ${diff.sourceRow}`}</strong>
                                        <span>
                                          Baris {diff.sourceRow}
                                          {diff.linked ? ' · Hubungkan kode existing' : ''}
                                        </span>
                                      </div>
                                      <span
                                        className={`setup-status setup-status--${diff.status.toLowerCase()}`}
                                      >
                                        {diff.status === 'NEW'
                                          ? 'Baru'
                                          : diff.status === 'INACTIVE'
                                            ? 'Arsip'
                                            : 'Berubah'}
                                      </span>
                                    </div>
                                    {diff.status === 'NEW' && (
                                      <dl className="setup-import-changes">
                                        {SETUP_SHEETS.find(
                                          (spec) => spec.name === sheet,
                                        )!.columns.map((column) => {
                                          const value =
                                            sheet === 'Checklist 4M' && column.key === 'question'
                                              ? rows
                                                  .filter(
                                                    (row) =>
                                                      row.sheet === sheet &&
                                                      row.data['category'] === diff.label,
                                                  )
                                                  .sort(
                                                    (a, b) =>
                                                      Number(a.data['order']) -
                                                      Number(b.data['order']),
                                                  )
                                                  .map((row) => row.data['question'])
                                                  .join('\n')
                                              : rows.find(
                                                  (row) =>
                                                    row.sheet === sheet &&
                                                    row.sourceRow === diff.sourceRow,
                                                )?.data[column.key];
                                          return value ? (
                                            <div key={column.key}>
                                              <dt>{column.label}</dt>
                                              <dd>
                                                <strong>
                                                  {column.key === 'password' ? '••••••••' : value}
                                                </strong>
                                              </dd>
                                            </div>
                                          ) : null;
                                        })}
                                      </dl>
                                    )}
                                    {diff.changes.length > 0 && (
                                      <dl className="setup-import-changes">
                                        {diff.changes.map((c) => (
                                          <div key={c.field}>
                                            <dt>{c.field}</dt>
                                            <dd>
                                              <span>{c.before || '—'}</span>
                                              <ChevronRight />
                                              <strong>{c.after || 'Kosongkan'}</strong>
                                            </dd>
                                          </div>
                                        ))}
                                      </dl>
                                    )}
                                    {diff.status !== 'NEW' && (
                                      <label className="setup-import-choice">
                                        <span>Aksi</span>
                                        <NativeSelect
                                          value={choices[diff.key] ?? ''}
                                          disabled={locked}
                                          onChange={(e) =>
                                            choose(
                                              diff.key,
                                              e.target.value as SetupDecision['action'],
                                            )
                                          }
                                        >
                                          <option value="" disabled>
                                            Pilih aksi
                                          </option>
                                          <option value="SKIP">Skip</option>
                                          <option
                                            value={
                                              diff.status === 'INACTIVE' ? 'RESTORE' : 'UPDATE'
                                            }
                                          >
                                            {diff.status === 'INACTIVE'
                                              ? 'Restore dan update'
                                              : 'Update'}
                                          </option>
                                        </NativeSelect>
                                      </label>
                                    )}
                                  </article>
                                ))}
                              </div>
                            ) : preview ? (
                              <div className="setup-import-sheet-empty">
                                <CheckCircle2 />
                                <strong>Data sudah sesuai</strong>
                                <span>Tidak ada perubahan yang perlu dipilih.</span>
                              </div>
                            ) : (
                              <div className="setup-import-sample-table">
                                <table>
                                  <thead>
                                    <tr>
                                      {SETUP_SHEETS.find((s) => s.name === sheet)!.columns.map(
                                        (c) => (
                                          <th key={c.key}>{c.label}</th>
                                        ),
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows
                                      .filter((r) => r.sheet === sheet)
                                      .slice(page * 10, (page + 1) * 10)
                                      .map((r) => (
                                        <tr
                                          key={r.sourceRow}
                                          className={
                                            highlight === r.sourceRow ? 'is-highlighted' : ''
                                          }
                                        >
                                          {SETUP_SHEETS.find((s) => s.name === sheet)!.columns.map(
                                            (c) => (
                                              <td key={c.key}>
                                                {c.key === 'password' && r.data[c.key]
                                                  ? '••••••••'
                                                  : r.data[c.key] || '—'}
                                              </td>
                                            ),
                                          )}
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {interesting.length > 50 && (
                              <div className="setup-import-pager">
                                <Button
                                  size="sm"
                                  disabled={page === 0}
                                  onClick={() => setPage(page - 1)}
                                >
                                  Sebelumnya
                                </Button>
                                <span>
                                  {page + 1} / {Math.ceil(interesting.length / 50)}
                                </span>
                                <Button
                                  size="sm"
                                  disabled={(page + 1) * 50 >= interesting.length}
                                  onClick={() => setPage(page + 1)}
                                >
                                  Berikutnya
                                </Button>
                              </div>
                            )}
                            {sheet === 'Member' &&
                              preview?.candidates.some((m) => m.role === 'MP') &&
                              rows.some(
                                (r) =>
                                  (r.sheet === 'Member' &&
                                    r.data['role'] === 'MP' &&
                                    preview.rows.find((d) => d.key === setupRowKey(r))?.status ===
                                      'NEW') ||
                                  Boolean(r.targetId),
                              ) && (
                                <div className="setup-import-linking">
                                  <h4>Hubungkan MP existing</h4>
                                  {rows
                                    .filter((r) => r.sheet === 'Member' && r.data['role'] === 'MP')
                                    .map((r) => (
                                      <label key={r.sourceRow}>
                                        <span>{r.data['name']}</span>
                                        <NativeSelect
                                          value={r.targetId ?? ''}
                                          disabled={locked}
                                          onChange={(e) => linkMember(r, e.target.value)}
                                        >
                                          <option value="">Member baru</option>
                                          {preview.candidates
                                            .filter((m) => m.role === 'MP')
                                            .map((m) => (
                                              <option key={m.id} value={m.id}>
                                                {m.name}
                                                {m.active ? '' : ' · Arsip'}
                                              </option>
                                            ))}
                                        </NativeSelect>
                                      </label>
                                    ))}
                                </div>
                              )}
                          </div>
                        </div>
                      )}
                      {unresolved > 0 && (
                        <p className="setup-import-note">
                          Pilih aksi untuk {unresolved} perubahan sebelum import.
                        </p>
                      )}
                      {[...warnings, ...(preview?.warnings ?? [])].length > 0 && (
                        <details className="setup-import-warnings">
                          <summary>
                            {[...warnings, ...(preview?.warnings ?? [])].length} catatan
                          </summary>
                          <ul>
                            {[...warnings, ...(preview?.warnings ?? [])].map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={discard}
        onOpenChange={setDiscard}
        size="sm"
        title="Tutup import?"
        description="File dan pilihan review belum disimpan."
        footer={
          <>
            <Button onClick={() => setDiscard(false)}>Kembali</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscard(false);
                clearFile();
                setOpen(false);
              }}
            >
              Tutup import
            </Button>
          </>
        }
      />
    </>
  );
}
