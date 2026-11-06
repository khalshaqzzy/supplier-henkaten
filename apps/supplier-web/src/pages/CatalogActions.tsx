import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, Check, Clock3, RefreshCw, Trash2 } from 'lucide-react';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type {
  DeletePartsRequest,
  ShiftTemplate,
  SwapShiftTimesRequest,
} from '@tmmin-henkaten/contracts';
import { Alert, Button, Dialog, ErrorState, Select, Skeleton, toast } from '@tmmin-henkaten/ui';
import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import './catalog-actions.css';

type Scope = { userId: string; supplierId: string; purpose: string };
function useCatalogScope() {
  const { session } = useSession();
  return {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
}
function message(error: unknown) {
  return error instanceof ApiProblemError
    ? error.problem.detail
    : 'Hasil belum dapat dipastikan. Coba lagi untuk memeriksa permintaan yang sama.';
}
function isUncertain(error: unknown) {
  return !(error instanceof ApiProblemError) || error.problem.status >= 500;
}
function useRefreshCatalog(scope: Scope) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedKey(scope, '').slice(0, 4) });
}
export function SwapShiftTimesAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        leadingIcon={<ArrowRightLeft aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Tukar waktu shift
      </Button>
      {open && <SwapShiftTimesSheet onClose={() => setOpen(false)} />}
    </>
  );
}
async function loadShiftTemplates() {
  const items: ShiftTemplate[] = [];
  let cursor: string | null = null;
  do {
    const page = await supplierApi.shiftTemplates({
      limit: 100,
      active: 'ACTIVE',
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.pageInfo.nextCursor;
  } while (cursor);
  return items;
}
function SwapShiftTimesSheet({ onClose }: { onClose: () => void }) {
  const scope = useCatalogScope();
  const refresh = useRefreshCatalog(scope);
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState(false);
  const pending = useRef<{ body: SwapShiftTimesRequest; key: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const shifts = useQuery({
    queryKey: scopedKey(scope, 'swap-shift-templates'),
    queryFn: loadShiftTemplates,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const lines = useQuery({
    queryKey: scopedKey(scope, 'all-line-shifts'),
    queryFn: () => supplierApi.allLineShifts(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const first = shifts.data?.find((shift) => shift.id === firstId);
  const second = shifts.data?.find((shift) => shift.id === secondId);
  const affected = [
    ...new Map(
      lines.data?.items
        .filter((line) => line.shiftTemplateId === firstId || line.shiftTemplateId === secondId)
        .map((line) => [line.lineId, line.lineCode]),
    ).values(),
  ];
  const sameTimes =
    first &&
    second &&
    first.startTime === second.startTime &&
    first.endTime === second.endTime &&
    first.timezone === second.timezone;
  const save = useMutation({
    mutationFn: () => {
      pending.current ??= {
        key: crypto.randomUUID(),
        body: {
          first: { id: first!.id, expectedVersion: first!.version },
          second: { id: second!.id, expectedVersion: second!.version },
        },
      };
      return supplierApi.swapShiftTimes(pending.current.body, pending.current.key);
    },
    onSuccess: () => {
      setDone(true);
      setUncertain(false);
      setError(null);
      toast.success('Waktu shift ditukar');
      void refresh();
    },
    onError: (problem) => {
      setError(problem);
      setUncertain(isUncertain(problem));
      if (!isUncertain(problem)) {
        pending.current = null;
        setStale(true);
      }
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });
  const locked = save.isPending || uncertain;
  const reload = async () => {
    await Promise.all([shifts.refetch(), lines.refetch()]);
    setFirstId('');
    setSecondId('');
    setStale(false);
    setError(null);
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !locked) onClose();
      }}
      dismissible={!locked}
      className="catalog-sheet"
      title={done ? 'Waktu shift berhasil ditukar' : 'Tukar waktu shift'}
      description={
        done ? 'Jadwal shift sudah diperbarui.' : 'Pilih dua shift untuk menukar waktu kerjanya.'
      }
      headerAdornment={done ? <Check aria-hidden="true" /> : <ArrowRightLeft aria-hidden="true" />}
      footer={
        done ? (
          <Button onClick={onClose}>Selesai</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={locked} onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={
                !first ||
                !second ||
                Boolean(sameTimes) ||
                stale ||
                shifts.isError ||
                lines.isError ||
                lines.isPending
              }
              onClick={() => save.mutate()}
            >
              {uncertain ? 'Periksa & coba lagi' : 'Tukar waktu shift'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="catalog-success">
          <Check aria-hidden="true" />
          <h3>Assignment tetap mengikuti nama shift</h3>
          <p>Waktu baru berlaku pada seluruh line yang menggunakan kedua shift.</p>
        </div>
      ) : (
        <>
          {error != null && (
            <div ref={errorRef} tabIndex={-1}>
              <Alert
                tone={uncertain ? 'warning' : 'danger'}
                title={uncertain ? 'Periksa hasil perubahan' : 'Waktu belum ditukar'}
              >
                {message(error)}
              </Alert>
              {stale && (
                <Button
                  variant="secondary"
                  leadingIcon={<RefreshCw aria-hidden="true" />}
                  onClick={() => void reload()}
                >
                  Muat ulang shift
                </Button>
              )}
            </div>
          )}
          {(shifts.isPending || lines.isPending) && (
            <div className="catalog-loading" aria-label="Memuat shift">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
          {(shifts.isError || lines.isError) && (
            <ErrorState
              title="Shift tidak dapat dimuat"
              description="Coba muat ulang untuk memilih shift."
              action={<Button onClick={() => void reload()}>Coba lagi</Button>}
            />
          )}
          {shifts.data && lines.data && (
            <>
              {shifts.data.length < 2 ? (
                <Alert tone="info" title="Perlu dua shift aktif">
                  Tambahkan atau aktifkan shift lain di Shift Template.
                </Alert>
              ) : (
                <>
                  <div className="catalog-shift-picker">
                    <label>
                      <span>Shift pertama</span>
                      <Select
                        label="Shift pertama"
                        value={firstId}
                        placeholder="Pilih shift pertama"
                        disabled={locked || stale}
                        onValueChange={setFirstId}
                        options={shifts.data.map((shift) => ({
                          value: shift.id,
                          label: shift.name,
                          description: `${shift.startTime}–${shift.endTime}${shift.crossesMidnight ? ' · +1 hari' : ''} · ${shift.timezone}`,
                          disabled: shift.id === secondId,
                        }))}
                      />
                    </label>
                    <ArrowRightLeft className="catalog-shift-picker__arrow" aria-hidden="true" />
                    <label>
                      <span>Shift kedua</span>
                      <Select
                        label="Shift kedua"
                        value={secondId}
                        placeholder="Pilih shift kedua"
                        disabled={locked || stale}
                        onValueChange={setSecondId}
                        options={shifts.data.map((shift) => ({
                          value: shift.id,
                          label: shift.name,
                          description: `${shift.startTime}–${shift.endTime}${shift.crossesMidnight ? ' · +1 hari' : ''} · ${shift.timezone}`,
                          disabled: shift.id === firstId,
                        }))}
                      />
                    </label>
                  </div>
                  {first && second ? (
                    <>
                      <section className="catalog-impact">
                        <h3>{affected.length} line menggunakan shift ini</h3>
                        {affected.length > 0 && (
                          <div className="catalog-line-tags">
                            {affected.map((code) => (
                              <span key={code}>{code}</span>
                            ))}
                          </div>
                        )}
                        <p>
                          Assignment MP, Supervisor, dan Line Leader tetap mengikuti nama shift.
                        </p>
                      </section>
                      <div className="catalog-section-heading">
                        <h3>Perubahan waktu</h3>
                        <span>Berlaku segera</span>
                      </div>
                      <div className="catalog-time-review">
                        <TimeChange shift={first} next={second} />
                        <TimeChange shift={second} next={first} />
                      </div>
                      {sameTimes && (
                        <Alert tone="warning" title="Waktu kedua shift sama">
                          Pilih pasangan dengan waktu yang berbeda.
                        </Alert>
                      )}
                    </>
                  ) : (
                    <div className="catalog-pair-empty">
                      <Clock3 aria-hidden="true" />
                      <h3>Bandingkan waktu sebelum menukar</h3>
                      <p>Pilih kedua shift untuk melihat waktu baru dan line yang terdampak.</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
function TimeChange({ shift, next }: { shift: ShiftTemplate; next: ShiftTemplate }) {
  return (
    <div className="catalog-time-row">
      <strong>{shift.name}</strong>
      <div className="catalog-time-row__times">
        <div>
          <small>Saat ini</small>
          <span>
            {shift.startTime}–{shift.endTime}
          </span>
          {shift.crossesMidnight && <small>Hingga hari berikutnya</small>}
          <small>{shift.timezone}</small>
        </div>
        <ArrowRight aria-hidden="true" />
        <div className="catalog-time-row__next">
          <small>Setelah ditukar</small>
          <span>
            {next.startTime}–{next.endTime}
          </span>
          {next.crossesMidnight && <small>Hingga hari berikutnya</small>}
          <small>{next.timezone}</small>
        </div>
      </div>
      <TimeTrack shift={next} />
    </div>
  );
}
function TimeTrack({ shift }: { shift: ShiftTemplate }) {
  const minute = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h! * 60 + m!;
  };
  const start = minute(shift.startTime),
    end = minute(shift.endTime);
  const spans =
    end < start
      ? [
          [0, end],
          [start, 1440],
        ]
      : [[start, end]];
  return (
    <div className="catalog-day" aria-hidden="true">
      <div className="catalog-day__track">
        {spans.map(([from, to], index) => (
          <span
            key={index}
            style={{ left: `${from! / 14.4}%`, width: `${(to! - from!) / 14.4}%` }}
          />
        ))}
      </div>
      <div className="catalog-day__axis">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}
export function DeleteAllPartsAction() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className="catalog-delete-trigger"
        leadingIcon={<Trash2 aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        Hapus semua part
      </Button>
      {open && <DeleteAllPartsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
function DeleteAllPartsDialog({ onClose }: { onClose: () => void }) {
  const scope = useCatalogScope();
  const refresh = useRefreshCatalog(scope);
  const [error, setError] = useState<unknown>(null);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const [deleted, setDeleted] = useState<number | null>(null);
  const pending = useRef<{ body: DeletePartsRequest; key: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const preview = useQuery({
    queryKey: scopedKey(scope, 'delete-parts-preview'),
    queryFn: () => supplierApi.deletePartsPreview(),
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationFn: () => {
      pending.current ??= { body: { revision: preview.data!.revision }, key: crypto.randomUUID() };
      return supplierApi.deleteAllParts(pending.current.body, pending.current.key);
    },
    onSuccess: (data) => {
      setDeleted(data.deleted);
      setUncertain(false);
      setError(null);
      toast.success(`${data.deleted} part dihapus`);
      void refresh();
    },
    onError: (problem) => {
      setError(problem);
      setUncertain(isUncertain(problem));
      if (!isUncertain(problem)) {
        pending.current = null;
        setStale(true);
      }
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });
  const locked = save.isPending || uncertain;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !locked) onClose();
      }}
      dismissible={!locked}
      className="catalog-delete-dialog"
      title={deleted === null ? 'Hapus semua part?' : 'Part berhasil dihapus'}
      description={
        deleted === null
          ? 'Tindakan ini berlaku untuk seluruh katalog Part supplier.'
          : `${deleted} part telah dihapus dari katalog.`
      }
      headerAdornment={
        deleted === null ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />
      }
      footer={
        deleted !== null ? (
          <Button onClick={onClose}>Selesai</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={locked} onClick={onClose}>
              Batal
            </Button>
            <Button
              variant="danger"
              loading={save.isPending}
              disabled={
                !uncertain &&
                (!preview.data?.count || preview.isFetching || stale || preview.isError)
              }
              onClick={() => save.mutate()}
            >
              {uncertain ? 'Periksa & coba lagi' : 'Hapus semua part'}
            </Button>
          </>
        )
      }
    >
      {error != null && (
        <div ref={errorRef} tabIndex={-1}>
          <Alert
            tone={uncertain ? 'warning' : 'danger'}
            title={uncertain ? 'Periksa hasil penghapusan' : 'Part belum dihapus'}
          >
            {message(error)}
          </Alert>
          {stale && (
            <Button
              variant="secondary"
              onClick={() => {
                void preview.refetch();
                setStale(false);
                setError(null);
              }}
            >
              Muat ulang ringkasan
            </Button>
          )}
        </div>
      )}
      {deleted === null && (
        <>
          {preview.isPending ? (
            <Skeleton />
          ) : preview.isError ? (
            <ErrorState
              title="Ringkasan tidak dapat dimuat"
              description="Muat ulang sebelum menghapus part."
              action={<Button onClick={() => void preview.refetch()}>Coba lagi</Button>}
            />
          ) : (
            <div className="catalog-delete-summary">
              <span>Part yang akan dihapus</span>
              <strong>{preview.data.count.toLocaleString('id-ID')}</strong>
              <small>Termasuk part aktif dan nonaktif, di luar filter daftar.</small>
            </div>
          )}
          <p className="catalog-delete-note">
            Riwayat Henkaten tetap tersedia. Part yang sudah dihapus tidak dapat dipilih untuk
            Henkaten baru.
          </p>
          {preview.data?.count === 0 && (
            <Alert tone="info" title="Katalog sudah kosong">
              Tidak ada part yang perlu dihapus.
            </Alert>
          )}
        </>
      )}
    </Dialog>
  );
}
