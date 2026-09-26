import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Alert, Button, Card, NativeSelect, toast } from '@tmmin-henkaten/ui';
import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { MasterBackLink } from './MasterDataPages';
import { parsePartFile, type PartImportRow } from './partImport';

type Preview = Awaited<ReturnType<typeof supplierApi.previewPartImport>>;
type Choice = 'UPDATE' | 'SKIP';

export function PartImportPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<PartImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [filter, setFilter] = useState<'ALL' | 'NEW' | 'EXISTING'>('ALL');
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
    mutationFn: async (selected: File) => {
      const parsed = await parsePartFile(selected);
      const response = await supplierApi.previewPartImport({
        rows: parsed.map(({ partNumber, partName }) => ({ partNumber, partName })),
      });
      return { parsed, response };
    },
    onSuccess: ({ parsed, response }) => {
      setRows(parsed);
      setPreview(response);
      setChoices({});
      setProblem(null);
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const commit = useMutation({
    mutationFn: () =>
      supplierApi.commitPartImport({
        rows: preview!.rows.map((row, index) => ({
          partNumber: row.partNumber,
          partName: row.partName,
          action: row.existing ? (choices[index] ?? 'SKIP') : 'CREATE',
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
      existingCount: all.filter((row) => row.existing).length,
      updateCount: all.filter((row, index) => row.existing && choices[index] === 'UPDATE').length,
    };
  }, [preview, choices]);
  const shown =
    preview?.rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) => filter === 'ALL' || (filter === 'NEW' ? !row.existing : Boolean(row.existing)),
      ) ?? [];
  const changeFile = (selected: File | null) => {
    setFile(selected);
    setRows([]);
    setPreview(null);
    setChoices({});
    setResult(null);
    setProblem(null);
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
            <Button variant="secondary" onClick={() => changeFile(null)}>
              Import file lain
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="part-import-upload">
            <div className="part-import-upload__heading">
              <UploadCloud aria-hidden="true" />
              <div>
                <h2>Pilih file</h2>
                <p>CSV atau Excel (.xlsx), maksimal 2 MB dan 500 baris.</p>
              </div>
            </div>
            <div className="part-import-upload__controls">
              <label className="part-import-file">
                <span>{file ? file.name : 'Pilih CSV atau Excel'}</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => changeFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Button variant="ghost" onClick={downloadTemplate}>
                Unduh template CSV
              </Button>
              <Button
                disabled={!file || review.isPending}
                loading={review.isPending}
                onClick={() => file && review.mutate(file)}
              >
                {preview ? 'Perbarui review' : 'Review file'}
              </Button>
            </div>
          </Card>
          {preview && (
            <section className="part-import-review" aria-label="Review import part">
              <div className="part-import-review__header">
                <div>
                  <span className="product-eyebrow">Review perubahan</span>
                  <h2>{preview.rows.length} part dalam file</h2>
                  <p>
                    {stats.newCount} baru · {stats.existingCount} sudah ada · {stats.updateCount}{' '}
                    dipilih untuk update
                  </p>
                </div>
                <div className="part-import-review__tools">
                  <NativeSelect
                    aria-label="Filter baris"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as typeof filter)}
                  >
                    <option value="ALL">Semua baris</option>
                    <option value="NEW">Part baru</option>
                    <option value="EXISTING">Sudah ada</option>
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!stats.existingCount}
                    onClick={() =>
                      setChoices(
                        Object.fromEntries(
                          preview.rows
                            .map((row, index) => (row.existing ? [index, 'UPDATE'] : null))
                            .filter((entry): entry is [number, string] => Boolean(entry)),
                        ) as Record<number, Choice>,
                      )
                    }
                  >
                    Update semua yang ada
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!stats.existingCount}
                    onClick={() => setChoices({})}
                  >
                    Lewati semua yang ada
                  </Button>
                </div>
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
                          {row.existing ? (
                            <>
                              {row.existing.partName}
                              {!row.existing.active && (
                                <small className="part-import-archived"> · Nonaktif</small>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td data-label="Nama dalam file">{row.partName}</td>
                        <td data-label="Keputusan">
                          {row.existing ? (
                            <NativeSelect
                              aria-label={`Keputusan ${row.partNumber}`}
                              value={choices[index] ?? 'SKIP'}
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
                          ) : (
                            <span className="part-import-new">Tambah</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="part-import-review__footer">
                <span>
                  {stats.newCount} tambah · {stats.updateCount} update ·{' '}
                  {stats.existingCount - stats.updateCount} lewati
                </span>
                <Button
                  loading={commit.isPending}
                  disabled={commit.isPending || stats.newCount + stats.updateCount === 0}
                  onClick={() => {
                    setProblem(null);
                    commit.mutate();
                  }}
                >
                  Simpan import
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
