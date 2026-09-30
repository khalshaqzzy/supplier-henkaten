import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { HenkatenExportFilters, HenkatenExportJob } from '@tmmin-henkaten/contracts';

import { Alert, Button, Input, NativeSelect, Progress, Spinner } from './primitives';
import { Sheet } from './advanced';

type Option = { id: string; label: string };

export function defaultExportPeriod(timezone: string, now = new Date()): HenkatenExportFilters {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const lastDay = new Date(
    Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const from = new Date(
    Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth(), Math.min(day, lastDay)),
  );
  return {
    from: from.toISOString().slice(0, 10),
    to: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export function HenkatenExportSheet({
  loadOptions,
  createExport,
  getExport,
  downloadUrl,
  storageKey,
  supplierLabel,
  supplierTimezone,
}: {
  loadOptions: () => Promise<{ lines: Option[]; shifts: Option[] }>;
  createExport: (filters: HenkatenExportFilters) => Promise<HenkatenExportJob>;
  getExport: (id: string) => Promise<HenkatenExportJob>;
  downloadUrl: (id: string) => string;
  storageKey: string;
  supplierLabel?: string | undefined;
  supplierTimezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ lines: Option[]; shifts: Option[] } | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [filters, setFilters] = useState<HenkatenExportFilters>(() =>
    defaultExportPeriod(supplierTimezone),
  );
  const [job, setJob] = useState<HenkatenExportJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || options) return;
    let active = true;
    setOptionsError(false);
    void loadOptions()
      .then((next) => {
        if (active) setOptions(next);
      })
      .catch(() => {
        if (active) setOptionsError(true);
      });
    return () => {
      active = false;
    };
  }, [open, options, loadOptions]);

  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) return;
    let active = true;
    void getExport(stored)
      .then((next) => {
        if (active) setJob(next);
      })
      .catch(() => sessionStorage.removeItem(storageKey));
    return () => {
      active = false;
    };
  }, [getExport, storageKey]);

  useEffect(() => {
    if (!job || !['QUEUED', 'RUNNING'].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void getExport(job.id)
        .then((next) => {
          setJob(next);
          setProblem(null);
        })
        .catch(() => {
          setProblem('Status ekspor tidak dapat dimuat. Coba lagi.');
          window.clearInterval(timer);
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [getExport, job]);

  const set = (key: keyof HenkatenExportFilters, value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value) Object.assign(next, { [key]: value });
      else delete next[key];
      return next;
    });
  };
  const validDateRange = !filters.from || !filters.to || filters.from <= filters.to;
  const processing = job?.status === 'QUEUED' || job?.status === 'RUNNING';
  const refreshJob = () => {
    if (!job) return;
    void getExport(job.id)
      .then((next) => {
        setJob(next);
        setProblem(null);
      })
      .catch(() => setProblem('Status ekspor tidak dapat dimuat. Coba lagi.'));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Export Henkaten"
      side="right"
      trigger={
        <Button variant="primary" leadingIcon={<FileSpreadsheet />}>
          Export Excel
        </Button>
      }
      footer={
        <div className="hds-export-footer">
          <Button
            variant="secondary"
            onClick={() => setFilters(defaultExportPeriod(supplierTimezone))}
            leadingIcon={<RotateCcw />}
          >
            Reset filter
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            disabled={!validDateRange || processing || submitting}
            leadingIcon={<Download />}
            onClick={() => {
              setProblem(null);
              setSubmitting(true);
              void createExport(filters)
                .then((next) => {
                  setJob(next);
                  sessionStorage.setItem(storageKey, next.id);
                })
                .catch(() => setProblem('Export gagal dimulai. Coba lagi.'))
                .finally(() => setSubmitting(false));
            }}
          >
            Buat workbook
          </Button>
        </div>
      }
    >
      <div className="hds-export-sheet">
        <div className="hds-export-intro">
          <span className="hds-export-icon">
            <FileSpreadsheet aria-hidden="true" />
          </span>
          <div>
            <strong>Data Hosted</strong>
            {supplierLabel && <small>{supplierLabel}</small>}
          </div>
          <span className="hds-export-format">.XLSX</span>
        </div>

        <div className="hds-export-section-title">
          <CalendarDays aria-hidden="true" /> Periode
        </div>
        <div className="hds-export-grid hds-export-grid--two">
          <label>
            <span>Dari</span>
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => set('from', event.target.value)}
            />
          </label>
          <label>
            <span>Sampai</span>
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => set('to', event.target.value)}
            />
          </label>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setFilters((current) => {
              const next = { ...current };
              delete next.from;
              delete next.to;
              return next;
            })
          }
        >
          Semua periode
        </Button>
        {!validDateRange && (
          <p className="hds-export-field-error">Tanggal akhir harus setelah tanggal awal.</p>
        )}

        <div className="hds-export-section-title">
          <SlidersHorizontal aria-hidden="true" /> Filter
        </div>
        {optionsError && (
          <Alert
            tone="danger"
            title="Pilihan filter gagal dimuat"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setOptionsError(false);
                  setOptions(null);
                }}
              >
                Coba lagi
              </Button>
            }
          />
        )}
        {!options && !optionsError && (
          <div className="hds-export-options-loading">
            <Spinner label="Memuat filter" /> Memuat filter
          </div>
        )}
        <div className="hds-export-grid">
          <label>
            <span>Line</span>
            <NativeSelect
              value={filters.lineId ?? ''}
              onChange={(event) => set('lineId', event.target.value)}
              disabled={!options}
            >
              <option value="">Semua line</option>
              {options?.lines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span>Shift</span>
            <NativeSelect
              value={filters.shiftTemplateId ?? ''}
              onChange={(event) => set('shiftTemplateId', event.target.value)}
              disabled={!options}
            >
              <option value="">Semua shift</option>
              {options?.shifts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span>Status</span>
            <NativeSelect
              value={filters.status ?? ''}
              onChange={(event) => set('status', event.target.value)}
            >
              <option value="">Semua status</option>
              <option value="OPEN">Open</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </NativeSelect>
          </label>
          <label>
            <span>4M</span>
            <NativeSelect
              value={filters.category ?? ''}
              onChange={(event) => set('category', event.target.value)}
            >
              <option value="">Semua kategori</option>
              <option value="MAN">Man</option>
              <option value="MACHINE">Machine</option>
              <option value="MATERIAL">Material</option>
              <option value="METHOD">Method</option>
            </NativeSelect>
          </label>
          <label>
            <span>Part</span>
            <Input
              value={filters.part ?? ''}
              placeholder="Nomor atau nama"
              onChange={(event) => set('part', event.target.value)}
            />
          </label>
          <label>
            <span>PCR</span>
            <NativeSelect
              value={filters.pcrStatus ?? ''}
              onChange={(event) => set('pcrStatus', event.target.value)}
            >
              <option value="">Semua PCR</option>
              <option value="PCR">PCR</option>
              <option value="NO_PCR">No-PCR</option>
              <option value="REVIEW">Review</option>
              <option value="PENDING">Pending</option>
            </NativeSelect>
          </label>
          <label>
            <span>Approval route</span>
            <NativeSelect
              value={filters.approvalRoute ?? ''}
              onChange={(event) => set('approvalRoute', event.target.value)}
            >
              <option value="">Semua route</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="QC">QC</option>
            </NativeSelect>
          </label>
          <label>
            <span>Approval status</span>
            <NativeSelect
              value={filters.approvalStatus ?? ''}
              onChange={(event) => set('approvalStatus', event.target.value)}
            >
              <option value="">Semua approval</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="NOT_REQUIRED">Not required</option>
            </NativeSelect>
          </label>
        </div>

        {(job || problem) && (
          <div className="hds-export-job" aria-live="polite">
            {problem && (
              <Alert
                tone="danger"
                title="Export bermasalah"
                action={
                  processing ? (
                    <Button size="sm" onClick={refreshJob}>
                      Muat ulang
                    </Button>
                  ) : undefined
                }
              >
                {problem}
              </Alert>
            )}
            {job?.status === 'QUEUED' && (
              <div className="hds-export-job-state">
                <Spinner label="Menunggu ekspor" />
                <div>
                  <strong>Menunggu</strong>
                  <small>Job dalam antrean</small>
                </div>
              </div>
            )}
            {job?.status === 'RUNNING' && (
              <div className="hds-export-job-progress">
                <div className="hds-export-job-state">
                  <Spinner label="Membuat workbook" />
                  <div>
                    <strong>Membuat workbook</strong>
                    <small>
                      {job.processed.toLocaleString('id-ID')} / {job.total.toLocaleString('id-ID')}{' '}
                      Henkaten
                    </small>
                  </div>
                </div>
                {job.total > 0 && (
                  <Progress
                    label="Henkaten diproses"
                    value={Math.round((job.processed / job.total) * 100)}
                  />
                )}
              </div>
            )}
            {job?.status === 'READY' && (
              <div className="hds-export-ready">
                <div>
                  <strong>Workbook siap</strong>
                  <small>{job.total.toLocaleString('id-ID')} Henkaten</small>
                </div>
                <a
                  className="hds-button hds-button--primary hds-button--sm"
                  href={downloadUrl(job.id)}
                >
                  <Download aria-hidden="true" /> Unduh
                </a>
              </div>
            )}
            {job?.status === 'FAILED' && (
              <Alert tone="danger" title="Export gagal">
                Coba buat workbook lagi.
              </Alert>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
