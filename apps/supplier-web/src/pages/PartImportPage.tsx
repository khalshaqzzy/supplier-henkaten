import { Check, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Button, Card, NativeSelect, toast } from '@tmmin-henkaten/ui';
import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { MasterBackLink } from './MasterDataPages';
import {
  parsePartMatrix,
  partCellText,
  partColumnLabel,
  readPartFile,
  suggestedPartMapping,
  type PartColumnMapping,
  type PartImportRow,
  type PartImportSheet,
} from './partImport';

type Preview = Awaited<ReturnType<typeof supplierApi.previewPartImport>>;
type Choice = 'UPDATE' | 'SKIP';

export function PartImportPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PartImportSheet | null>(null);
  const [mapping, setMapping] = useState<PartColumnMapping>({ numberIndex: -1, nameIndex: -1 });
  const [reading, setReading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const uploadSequence = useRef(0);
  const [rows, setRows] = useState<PartImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [conflictPage, setConflictPage] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
  } | null>(null);
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const review = useMutation({
    mutationFn: async ({ parsed }: { parsed: PartImportRow[]; sequence: number }) => {
      const response = await supplierApi.previewPartImport({
        rows: parsed.map(({ partNumber, partName }) => ({ partNumber, partName })),
      });
      return { parsed, response };
    },
    onSuccess: ({ parsed, response }, variables) => {
      if (variables.sequence !== uploadSequence.current) return;
      setRows(parsed);
      setPreview(response);
      setChoices({});
      setConflictPage(0);
      setProblem(null);
    },
    onError: (error, variables) => {
      if (variables.sequence === uploadSequence.current) setProblem(problemMessage(error));
    },
  });
  const commit = useMutation({
    mutationFn: () =>
      supplierApi.commitPartImport({
        rows: preview!.rows.map((row, index) => ({
          partNumber: row.partNumber,
          partName: row.partName,
          action: row.existing ? (isChanged(row) ? (choices[index] ?? 'SKIP') : 'SKIP') : 'CREATE',
          ...(row.existing
            ? { existingId: row.existing.id, expectedVersion: row.existing.version }
            : {}),
        })),
      }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-parts').slice(0, -1),
      });
      setResult(saved);
      setSheet(null);
      setRows([]);
      setPreview(null);
      setChoices({});
      setFileName(null);
      setProblem(null);
      toast.success(
        'Import part selesai',
        `${saved.created} ditambahkan · ${saved.updated} diperbarui · ${saved.skipped} dilewati`,
      );
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const stats = useMemo(() => {
    const all = preview?.rows ?? [];
    return {
      newCount: all.filter((row) => !row.existing).length,
      changedCount: all.filter(isChanged).length,
      sameCount: all.filter((row) => row.existing && !isChanged(row)).length,
    };
  }, [preview]);
  const updateCount = Object.values(choices).filter((choice) => choice === 'UPDATE').length;
  const conflicts = useMemo(
    () => preview?.rows.flatMap((row, index) => (isChanged(row) ? [{ row, index }] : [])) ?? [],
    [preview],
  );
  const conflictPageCount = Math.ceil(conflicts.length / 50);
  const shown = conflicts.slice(conflictPage * 50, (conflictPage + 1) * 50);
  const resetFile = () => {
    uploadSequence.current++;
    setFileName(null);
    setSheet(null);
    setMapping({ numberIndex: -1, nameIndex: -1 });
    setReading(false);
    setProcessing(false);
    setRows([]);
    setPreview(null);
    setChoices({});
    setResult(null);
    setProblem(null);
  };
  const changeFile = async (selected: File | null) => {
    resetFile();
    if (!selected) return;
    const sequence = uploadSequence.current;
    setReading(true);
    setFileName(selected.name);
    try {
      const parsed = await readPartFile(selected);
      if (sequence !== uploadSequence.current) return;
      setSheet(parsed);
      setMapping(suggestedPartMapping(parsed.headers));
    } catch (error) {
      if (sequence === uploadSequence.current) setProblem(problemMessage(error));
    } finally {
      if (sequence === uploadSequence.current) setReading(false);
    }
  };
  const reviewMapping = async () => {
    if (!sheet) return;
    setProcessing(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const parsed = parsePartMatrix(sheet.matrix, mapping);
      setProblem(null);
      review.mutate({ parsed, sequence: uploadSequence.current });
    } catch (error) {
      setProblem(problemMessage(error));
    } finally {
      setProcessing(false);
    }
  };
  const downloadTemplate = () => {
    const csv = '\uFEFFPart number,Nama part\r\n123456789,Contoh nama part\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'template-import-part.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="product-page part-import-page">
      <MasterBackLink to="/master-data/parts" label="Part" />
      <PageHeader eyebrow="Master Data · Part" title="Import part" description="" />
      {problem && (
        <Alert tone="danger" title="Import belum disimpan">
          {problem}
        </Alert>
      )}
      {result ? (
        <Card className="part-import-result">
          <FileSpreadsheet aria-hidden="true" />
          <h2>Import selesai</h2>
          <div className="part-import-stats">
            <strong>
              {result.created}
              <small>Ditambahkan</small>
            </strong>
            <strong>
              {result.updated}
              <small>Diperbarui</small>
            </strong>
            <strong>
              {result.skipped}
              <small>Dilewati</small>
            </strong>
          </div>
          <div className="form-actions">
            <Link className="hds-button hds-button--primary hds-button--md" to="/master-data/parts">
              Lihat daftar part
            </Link>
            <Button variant="secondary" onClick={resetFile}>
              Import file lain
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="part-import-steps" aria-label="Tahap import">
            <span className={sheet || preview ? 'is-complete' : 'is-current'}>
              1 <b>Pilih file</b>
            </span>
            <span className={preview ? 'is-complete' : sheet ? 'is-current' : ''}>
              2 <b>Petakan kolom</b>
            </span>
            <span className={preview ? 'is-current' : ''}>
              3 <b>Review & simpan</b>
            </span>
          </div>
          <Card className="part-import-upload">
            <div className="part-import-upload__heading">
              <UploadCloud aria-hidden="true" />
              <div>
                <h2>Pilih file</h2>
                <p>CSV atau Excel (.xlsx), maksimal 50 MB dan 50.000 baris data.</p>
              </div>
            </div>
            <div className="part-import-upload__controls">
              <label className="part-import-file">
                <span>{fileName ?? 'Pilih CSV atau Excel'}</span>
                <input
                  type="file"
                  disabled={reading || processing || review.isPending || commit.isPending}
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    void changeFile(event.target.files?.[0] ?? null);
                    event.target.value = '';
                  }}
                />
              </label>
              <Button variant="ghost" onClick={downloadTemplate}>
                Unduh template CSV
              </Button>
            </div>
          </Card>
          {(reading || processing || review.isPending) && (
            <div className="part-import-progress" role="status" aria-live="polite">
              <span className="part-import-saving__spinner" aria-hidden="true" />
              <div>
                <strong>
                  {reading
                    ? 'Membaca file…'
                    : processing
                      ? 'Memvalidasi data…'
                      : 'Mencocokkan part…'}
                </strong>
                <span>
                  {reading
                    ? 'Menyiapkan kolom dan preview.'
                    : processing
                      ? 'Memeriksa nomor part dan data wajib.'
                      : 'Memeriksa nama part yang berbeda di sistem.'}
                </span>
              </div>
            </div>
          )}
          {sheet && !preview && (
            <section className="part-import-mapping" aria-label="Pemetaan kolom">
              <div className="part-import-review__header">
                <div>
                  <span className="product-eyebrow">Pemetaan kolom</span>
                  <h2>Pilih data yang akan diimpor</h2>
                  <p>
                    {sheet.dataRowCount} baris data · {sheet.headers.length} kolom ditemukan
                  </p>
                </div>
                <span className="part-import-step-tag">Langkah 2 dari 3</span>
              </div>
              <div className="part-import-mapping__fields">
                <label>
                  <span>Kolom Part number</span>
                  <NativeSelect
                    value={mapping.numberIndex}
                    disabled={processing || review.isPending}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        numberIndex: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={-1}>Pilih kolom</option>
                    {sheet.headers.map((header, index) => (
                      <option key={index} value={index} disabled={index === mapping.nameIndex}>
                        {partColumnLabel(index)} · {header || 'Tanpa judul'}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  <span>Kolom Nama part</span>
                  <NativeSelect
                    value={mapping.nameIndex}
                    disabled={processing || review.isPending}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        nameIndex: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={-1}>Pilih kolom</option>
                    {sheet.headers.map((header, index) => (
                      <option key={index} value={index} disabled={index === mapping.numberIndex}>
                        {partColumnLabel(index)} · {header || 'Tanpa judul'}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <div className="part-import-sample-heading">
                <div>
                  <h3>Preview file</h3>
                  <p>10 baris pertama · kolom lain tetap terlihat untuk membantu pemetaan</p>
                  <span className="part-import-swipe-hint">
                    Geser tabel untuk melihat kolom lain →
                  </span>
                </div>
              </div>
              <div className="part-import-sample-scroll">
                <table className="part-import-sample">
                  <thead>
                    <tr>
                      <th>Baris</th>
                      {sheet.headers.map((header, index) => (
                        <th
                          key={index}
                          className={
                            index === mapping.numberIndex || index === mapping.nameIndex
                              ? 'is-selected'
                              : ''
                          }
                        >
                          <small>{partColumnLabel(index)}</small>
                          {header || 'Tanpa judul'}
                          {index === mapping.numberIndex && <em>Part number</em>}
                          {index === mapping.nameIndex && <em>Nama part</em>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.matrix.slice(1, 11).map((cells, rowIndex) => (
                      <tr key={rowIndex}>
                        <td>{rowIndex + 2}</td>
                        {sheet.headers.map((_, columnIndex) => (
                          <td
                            key={columnIndex}
                            className={
                              columnIndex === mapping.numberIndex ||
                              columnIndex === mapping.nameIndex
                                ? 'is-selected'
                                : ''
                            }
                          >
                            {partCellText(cells[columnIndex]) || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="part-import-review__footer">
                <span>
                  {mapping.numberIndex >= 0 && mapping.nameIndex >= 0
                    ? 'Dua kolom siap direview'
                    : 'Pilih kedua kolom untuk melanjutkan'}
                </span>
                <Button
                  loading={processing || review.isPending}
                  disabled={
                    processing ||
                    review.isPending ||
                    mapping.numberIndex < 0 ||
                    mapping.nameIndex < 0 ||
                    mapping.numberIndex === mapping.nameIndex
                  }
                  onClick={() => void reviewMapping()}
                >
                  {processing
                    ? 'Memvalidasi data…'
                    : review.isPending
                      ? 'Mencocokkan part…'
                      : 'Review perubahan'}
                </Button>
              </div>
            </section>
          )}
          {preview && (
            <section className="part-import-review" aria-label="Review import part">
              <div className="part-import-review__header">
                <div>
                  <span className="product-eyebrow">Konfirmasi konflik</span>
                  <h2>{preview.rows.length} part dalam file</h2>
                  <p>
                    {stats.newCount} baru · {stats.changedCount} nama berbeda · {stats.sameCount}{' '}
                    sudah sesuai
                  </p>
                </div>
                <div className="part-import-review__tools">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!stats.changedCount || commit.isPending}
                    onClick={() =>
                      setChoices(
                        Object.fromEntries(
                          preview.rows
                            .map((row, index) => (isChanged(row) ? [index, 'UPDATE'] : null))
                            .filter((entry): entry is [number, string] => Boolean(entry)),
                        ) as Record<number, Choice>,
                      )
                    }
                  >
                    Update semua yang berbeda
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!stats.changedCount || commit.isPending}
                    onClick={() => setChoices({})}
                  >
                    Lewati semua yang berbeda
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={commit.isPending}
                    onClick={() => {
                      setPreview(null);
                      setChoices({});
                      setProblem(null);
                    }}
                  >
                    Ubah kolom
                  </Button>
                </div>
              </div>
              {stats.changedCount === 0 ? (
                <div className="part-import-no-conflicts" role="status">
                  <Check aria-hidden="true" />
                  <div>
                    <strong>Tidak ada nama yang berbeda</strong>
                    <span>Part baru siap ditambahkan. Part yang sudah sesuai akan dilewati.</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="part-import-conflict-heading">
                    <div>
                      <h3>Nama part yang berbeda</h3>
                      <p>Pilih tindakan untuk setiap part. Default: Lewati.</p>
                    </div>
                    <span>{stats.changedCount.toLocaleString('id-ID')} konflik</span>
                  </div>
                  <div className="data-table-wrap">
                    <table className="data-table part-import-table">
                      <thead>
                        <tr>
                          <th>Baris</th>
                          <th>Part number</th>
                          <th>Nama di sistem</th>
                          <th>Nama dalam file</th>
                          <th>Keputusan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map(({ row, index }) => (
                          <tr key={`${row.partNumber}-${index}`}>
                            <td data-label="Baris">{rows[index]?.sourceRow ?? index + 2}</td>
                            <td data-label="Part number">
                              <strong>{row.partNumber}</strong>
                            </td>
                            <td data-label="Nama di sistem">
                              {row.existing?.partName}
                              {row.existing && !row.existing.active && (
                                <small className="part-import-archived"> · Nonaktif</small>
                              )}
                            </td>
                            <td data-label="Nama dalam file">{row.partName}</td>
                            <td data-label="Keputusan">
                              <NativeSelect
                                aria-label={`Keputusan ${row.partNumber}`}
                                value={choices[index] ?? 'SKIP'}
                                disabled={commit.isPending}
                                onChange={(event) =>
                                  setChoices((current) => ({
                                    ...current,
                                    [index]: event.target.value as Choice,
                                  }))
                                }
                              >
                                <option value="SKIP">Lewati</option>
                                <option value="UPDATE">Update nama</option>
                              </NativeSelect>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {conflictPageCount > 1 && (
                    <div className="part-import-pagination">
                      <span>
                        Menampilkan {conflictPage * 50 + 1}–
                        {Math.min((conflictPage + 1) * 50, conflicts.length)} dari{' '}
                        {conflicts.length.toLocaleString('id-ID')}
                      </span>
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={conflictPage === 0 || commit.isPending}
                          onClick={() => setConflictPage((current) => current - 1)}
                        >
                          Sebelumnya
                        </Button>
                        <span>
                          Halaman {conflictPage + 1} / {conflictPageCount}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={conflictPage + 1 >= conflictPageCount || commit.isPending}
                          onClick={() => setConflictPage((current) => current + 1)}
                        >
                          Berikutnya
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {commit.isPending && (
                <div className="part-import-saving" role="status">
                  <span className="part-import-saving__spinner" aria-hidden="true" />
                  <div>
                    <strong>Menyimpan import…</strong>
                    <span>
                      Tetap di halaman sampai proses selesai. Import besar dapat memerlukan beberapa
                      menit.
                    </span>
                  </div>
                </div>
              )}
              <div className="part-import-review__footer">
                <span>
                  {stats.newCount + updateCount === 0
                    ? 'Tidak ada perubahan untuk disimpan'
                    : `${stats.newCount} tambah · ${updateCount} update · ${stats.changedCount - updateCount} lewati · ${stats.sameCount} sudah sesuai`}
                </span>
                <Button
                  loading={commit.isPending}
                  disabled={commit.isPending || stats.newCount + updateCount === 0}
                  onClick={() => {
                    setProblem(null);
                    commit.mutate();
                  }}
                >
                  {commit.isPending ? 'Menyimpan…' : 'Simpan import'}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function problemMessage(error: unknown) {
  return error instanceof ApiProblemError
    ? error.problem.detail
    : error instanceof Error
      ? error.message
      : 'File tidak dapat diproses. Coba lagi.';
}

function isChanged(row: Preview['rows'][number]) {
  return Boolean(row.existing && row.existing.partName.trim() !== row.partName.trim());
}
