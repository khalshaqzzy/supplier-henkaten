import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CalendarSync,
  History,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Trash2,
  X,
} from 'lucide-react';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { ShiftRotation, ShiftTemplate } from '@tmmin-henkaten/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Switch,
  toast,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { RestoreFocus, useRestoreFocus } from '../app/restore-focus';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { loadShiftTemplates } from './CatalogActions';

import { DAY_FULL, DAY_SHORT, scheduleLabel } from './ShiftSchedule';
import './catalog-actions.css';
import './shift-rotation.css';

type Scope = { userId: string; supplierId: string; purpose: string };

function useScope(): Scope {
  const { session } = useSession();
  return {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
}

function problemText(error: unknown) {
  return error instanceof ApiProblemError
    ? error.problem.detail
    : 'Perubahan tidak dapat dipastikan. Muat ulang lalu coba lagi.';
}

function formatRun(iso: string, timeZone: string) {
  const date = new Date(iso);
  const text = date.toLocaleString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  const diff = date.getTime() - Date.now();
  const relative = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });
  const minutes = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const rel =
    Math.abs(minutes) < 60
      ? relative.format(minutes, 'minute')
      : Math.abs(hours) < 24
        ? relative.format(hours, 'hour')
        : relative.format(Math.round(diff / 86_400_000), 'day');
  return { text, rel };
}

export function ShiftRotationPanel({ canManage }: { canManage: boolean }) {
  const scope = useScope();
  const client = useQueryClient();
  const [editing, setEditing] = useState<ShiftRotation | 'new' | null>(null);
  const rotations = useQuery({
    queryKey: scopedKey(scope, 'shift-rotations'),
    queryFn: () => supplierApi.shiftRotations(),
  });
  const refresh = () => client.invalidateQueries({ queryKey: scopedKey(scope, '').slice(0, 4) });
  const items = rotations.data?.items ?? [];

  return (
    <section className="rotation-panel" aria-labelledby="rotation-panel-title">
      <header className="rotation-panel__head">
        <span className="rotation-panel__icon">
          <CalendarSync aria-hidden="true" />
        </span>
        <div>
          <h2 id="rotation-panel-title" tabIndex={-1}>
            Jadwal pergantian shift
          </h2>
          <small>
            {rotations.isPending
              ? 'Memuat jadwal…'
              : rotations.isError
                ? '—'
                : items.length
                  ? `${items.filter((item) => item.enabled).length} aktif · ${items.length} jadwal`
                  : 'Belum ada jadwal'}
          </small>
        </div>
        {canManage && items.length > 0 && (
          <Button
            variant="secondary"
            leadingIcon={<Plus aria-hidden="true" />}
            onClick={() => setEditing('new')}
          >
            Buat jadwal
          </Button>
        )}
      </header>
      {rotations.isPending ? (
        <div className="rotation-grid">
          <Skeleton />
          <Skeleton />
        </div>
      ) : rotations.isError ? (
        <ErrorState
          title="Jadwal tidak dapat dimuat"
          description="Coba muat ulang."
          action={<Button onClick={() => void rotations.refetch()}>Coba lagi</Button>}
        />
      ) : items.length === 0 ? (
        <div className="rotation-empty">
          <Repeat2 aria-hidden="true" />
          <div>
            <strong>Tukar jam shift otomatis setiap minggu</strong>
            <span>Pilih shift, hari, dan jam pergantian.</span>
          </div>
          {canManage && (
            <Button
              variant="primary"
              leadingIcon={<Plus aria-hidden="true" />}
              onClick={() => setEditing('new')}
            >
              Buat jadwal
            </Button>
          )}
        </div>
      ) : (
        <div className="rotation-grid">
          {items.map((rotation) => (
            <RotationCard
              key={rotation.id}
              rotation={rotation}
              canManage={canManage}
              onEdit={() => setEditing(rotation)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      {editing && (
        <RotationSheet
          rotation={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function CycleChips({ rotation }: { rotation: ShiftRotation }) {
  const two = rotation.shifts.length === 2;
  return (
    <div className="rotation-cycle" aria-label="Urutan siklus">
      {rotation.shifts.map((shift, index) => (
        <span key={shift.id} className="rotation-cycle__item">
          <span
            className={
              shift.available && shift.active ? 'rotation-chip' : 'rotation-chip is-unavailable'
            }
          >
            {shift.name}
          </span>
          {index < rotation.shifts.length - 1 &&
            (two ? (
              <Repeat2 aria-label="saling tukar" className="rotation-cycle__arrow" />
            ) : (
              <ArrowRight aria-hidden="true" className="rotation-cycle__arrow" />
            ))}
        </span>
      ))}
      {!two && (
        <span className="rotation-cycle__loop" title="Kembali ke shift pertama">
          <Repeat2 aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

function RotationCard({
  rotation,
  canManage,
  onEdit,
  onChanged,
}: {
  rotation: ShiftRotation;
  canManage: boolean;
  onEdit: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [confirm, setConfirm] = useState<'run' | 'delete' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const unavailable = rotation.shifts.filter((shift) => !shift.available || !shift.active);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      supplierApi.updateShiftRotation(rotation.id, {
        expectedVersion: rotation.version,
        enabled,
      }),
    onSuccess: async (next) => {
      setProblem(null);
      toast.success(next.enabled ? 'Jadwal diaktifkan' : 'Jadwal dijeda');
      await onChanged();
    },
    onError: (error) => setProblem(problemText(error)),
  });
  const run = useMutation({
    mutationFn: () => supplierApi.runShiftRotation(rotation.id, rotation.version),
    onSuccess: async () => {
      setConfirm(null);
      setProblem(null);
      toast.success('Jam shift dirotasi');
      await onChanged();
    },
    onError: (error) => {
      setConfirm(null);
      setProblem(problemText(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => supplierApi.deleteShiftRotation(rotation.id, rotation.version),
    onSuccess: async () => {
      setConfirm(null);
      toast.success('Jadwal dihapus');
      await onChanged();
    },
    onError: (error) => {
      setConfirm(null);
      setProblem(problemText(error));
    },
  });
  const next = rotation.nextRunAt ? formatRun(rotation.nextRunAt, rotation.timezone) : null;

  return (
    <article className={rotation.enabled ? 'rotation-card' : 'rotation-card is-paused'}>
      <header className="rotation-card__head">
        <div>
          <h3>{rotation.name}</h3>
          <Badge tone={rotation.enabled ? 'success' : 'neutral'}>
            {rotation.enabled ? 'Aktif' : 'Dijeda'}
          </Badge>
        </div>
        {canManage && (
          <Switch
            label={<span className="sr-only">Aktifkan {rotation.name}</span>}
            checked={rotation.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate(checked)}
          />
        )}
      </header>
      <CycleChips rotation={rotation} />
      <dl className="rotation-card__meta">
        <div>
          <dt>
            <CalendarClock aria-hidden="true" /> Jadwal
          </dt>
          <dd>
            Setiap {DAY_FULL[rotation.dayOfWeek - 1]} · {rotation.executeTime}
            <small>{rotation.timezone}</small>
          </dd>
        </div>
        <div>
          <dt>Berikutnya</dt>
          <dd>
            {next ? (
              <>
                {next.text}
                <small>{next.rel}</small>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Terakhir</dt>
          <dd>
            {rotation.lastRunAt ? (
              <>
                <span className="rotation-card__last">
                  <Badge tone={rotation.lastRunStatus === 'SUCCESS' ? 'success' : 'warning'}>
                    {rotation.lastRunStatus === 'SUCCESS' ? 'Berhasil' : 'Dilewati'}
                  </Badge>
                  {formatRun(rotation.lastRunAt, rotation.timezone).text}
                </span>
                {rotation.lastRunMessage && <small>{rotation.lastRunMessage}</small>}
              </>
            ) : (
              'Belum pernah'
            )}
          </dd>
        </div>
      </dl>
      {unavailable.length > 0 && (
        <Alert tone="warning" title="Shift tidak tersedia">
          {unavailable.map((shift) => shift.name).join(', ')} nonaktif atau dihapus. Ubah urutan
          siklus.
        </Alert>
      )}
      {problem && (
        <Alert tone="danger" title="Perubahan gagal">
          {problem}
        </Alert>
      )}
      {showHistory && (
        <ol className="rotation-history">
          {rotation.executions.length === 0 && <li className="is-empty">Belum ada riwayat</li>}
          {rotation.executions.map((execution) => (
            <li key={execution.id}>
              <Badge tone={execution.status === 'SUCCESS' ? 'success' : 'warning'}>
                {execution.status === 'SUCCESS' ? 'Berhasil' : 'Dilewati'}
              </Badge>
              <span>
                {formatRun(execution.executedAt, rotation.timezone).text}
                <small>
                  {execution.trigger === 'MANUAL' ? 'Manual' : 'Terjadwal'}
                  {execution.message ? ` · ${execution.message}` : ''}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
      <footer className="rotation-card__actions">
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<History aria-hidden="true" />}
          aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          Riwayat
        </Button>
        {canManage && (
          <>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Pencil aria-hidden="true" />}
              onClick={onEdit}
            >
              Ubah
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Play aria-hidden="true" />}
              disabled={unavailable.length > 0}
              onClick={() => setConfirm('run')}
            >
              Jalankan sekarang
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rotation-card__delete"
              aria-label={`Hapus ${rotation.name}`}
              title="Hapus jadwal"
              onClick={() => setConfirm('delete')}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </>
        )}
      </footer>
      {confirm && <RestoreFocus fallbackId="rotation-panel-title" />}
      {confirm && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !run.isPending && !remove.isPending) setConfirm(null);
          }}
          dismissible={!run.isPending && !remove.isPending}
          className={`catalog-delete-dialog rotation-confirm${confirm === 'run' ? ' rotation-confirm--run' : ''}`}
          title={confirm === 'run' ? 'Rotasi jam shift sekarang?' : 'Hapus jadwal ini?'}
          description={rotation.name}
          headerAdornment={
            confirm === 'run' ? <Play aria-hidden="true" /> : <Trash2 aria-hidden="true" />
          }
          footer={
            <>
              <Button
                variant="secondary"
                disabled={run.isPending || remove.isPending}
                onClick={() => setConfirm(null)}
              >
                Batal
              </Button>
              <Button
                variant={confirm === 'run' ? 'primary' : 'danger'}
                loading={run.isPending || remove.isPending}
                onClick={() => (confirm === 'run' ? run.mutate() : remove.mutate())}
              >
                {confirm === 'run' ? 'Rotasi sekarang' : 'Hapus jadwal'}
              </Button>
            </>
          }
        >
          {confirm === 'run' ? (
            <>
              <CycleChips rotation={rotation} />
              <p className="catalog-delete-note">
                Jam baru langsung berlaku di semua line yang memakai shift ini.
                {next ? ` Jadwal berikutnya tetap ${next.text}.` : ''}
              </p>
            </>
          ) : (
            <p className="catalog-delete-note">
              Jadwal dan riwayat pelaksanaannya dihapus permanen. Jam shift saat ini tetap berlaku.
            </p>
          )}
        </Dialog>
      )}
    </article>
  );
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';
  } catch {
    return 'Asia/Jakarta';
  }
}

function RotationSheet({
  rotation,
  onClose,
  onSaved,
}: {
  rotation: ShiftRotation | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const scope = useScope();
  const shifts = useQuery({
    queryKey: scopedKey(scope, 'rotation-shift-templates'),
    queryFn: loadShiftTemplates,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [name, setName] = useState(rotation?.name ?? 'Rotasi mingguan');
  const [ids, setIds] = useState<string[]>(rotation?.shifts.map((shift) => shift.id) ?? ['', '']);
  const [dayOfWeek, setDayOfWeek] = useState(rotation?.dayOfWeek ?? 1);
  const [executeTime, setExecuteTime] = useState(rotation?.executeTime ?? '06:00');
  const [timezone, setTimezone] = useState(rotation?.timezone ?? defaultTimezone());
  const [enabled, setEnabled] = useState(rotation?.enabled ?? true);
  const [problem, setProblem] = useState<string | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  useRestoreFocus();
  const dayName = useId();
  const byId = useMemo(
    () => new Map((shifts.data ?? []).map((shift) => [shift.id, shift] as const)),
    [shifts.data],
  );
  const chosen = ids.map((id) => byId.get(id));
  // A saved shift that was archived or deleted is not in the active list: it must be replaced.
  const missing = (shifts.data?.length ?? 0) >= 2 && ids.some((id) => Boolean(id) && !byId.has(id));
  // Preview and save rely on a successful, current shift list, never on stale cached data.
  const complete =
    shifts.isSuccess &&
    !shifts.isFetching &&
    ids.every((id) => Boolean(id) && byId.has(id)) &&
    new Set(ids).size === ids.length;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        shiftTemplateIds: ids,
        dayOfWeek,
        executeTime,
        timezone: timezone.trim(),
        enabled,
      };
      return rotation
        ? supplierApi.updateShiftRotation(rotation.id, {
            expectedVersion: rotation.version,
            ...body,
          })
        : supplierApi.createShiftRotation(body);
    },
    onSuccess: async () => {
      toast.success(rotation ? 'Jadwal disimpan' : 'Jadwal dibuat');
      await onSaved();
    },
    onError: (error) => {
      setProblem(problemText(error));
      requestAnimationFrame(() => problemRef.current?.focus());
    },
  });
  const move = (index: number, delta: number) => {
    const next = [...ids];
    const target = index + delta;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setIds(next);
  };
  const shiftOptions = (index: number) =>
    (shifts.data ?? []).map((shift) => ({
      value: shift.id,
      label: shift.name,
      description: scheduleLabel(shift.weeklySchedule),
      disabled: ids.some((id, other) => other !== index && id === shift.id),
    }));
  const mixedZones = complete && new Set(chosen.map((shift) => shift!.timezone)).size > 1;
  const identical =
    complete &&
    new Set(chosen.map((shift) => JSON.stringify([shift!.timezone, shift!.weeklySchedule])))
      .size === 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      dismissible={!save.isPending}
      className="catalog-sheet rotation-sheet"
      title={rotation ? 'Ubah jadwal pergantian' : 'Jadwal pergantian shift'}
      headerAdornment={<CalendarSync aria-hidden="true" />}
      footer={
        <>
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!complete || !name.trim() || !executeTime || !timezone.trim() || identical}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {rotation ? 'Simpan jadwal' : 'Buat jadwal'}
          </Button>
        </>
      }
    >
      {problem && (
        <div ref={problemRef} tabIndex={-1} className="rotation-problem">
          <Alert tone="danger" title="Jadwal belum disimpan">
            {problem}
          </Alert>
        </div>
      )}
      <label className="rotation-field">
        <span>Nama jadwal</span>
        <Input value={name} maxLength={150} onChange={(event) => setName(event.target.value)} />
      </label>

      <section className="rotation-section">
        <div className="catalog-section-heading">
          <h3>Shift dalam siklus</h3>
          <span>{ids.length === 2 ? 'Saling tukar' : `${ids.length} shift berputar`}</span>
        </div>
        {shifts.isPending ? (
          <Skeleton />
        ) : shifts.isError ? (
          <ErrorState
            title="Shift tidak dapat dimuat"
            description="Coba muat ulang."
            action={<Button onClick={() => void shifts.refetch()}>Coba lagi</Button>}
          />
        ) : (shifts.data?.length ?? 0) < 2 ? (
          <Alert tone="info" title="Perlu dua shift aktif">
            Tambahkan atau aktifkan shift lain di Shift Template.
          </Alert>
        ) : (
          <ol className="rotation-slots">
            {ids.map((id, index) => (
              <li key={index}>
                <span className="rotation-slots__index">{index + 1}</span>
                <Select
                  label={`Shift ${index + 1}`}
                  value={byId.has(id) ? id : ''}
                  placeholder="Pilih shift"
                  onValueChange={(value) =>
                    setIds(ids.map((current, other) => (other === index ? value : current)))
                  }
                  options={shiftOptions(index)}
                />
                <div className="rotation-slots__tools">
                  <button
                    type="button"
                    aria-label={`Naikkan shift ${index + 1}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Turunkan shift ${index + 1}`}
                    disabled={index === ids.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Keluarkan shift ${index + 1}`}
                    disabled={ids.length <= 2}
                    onClick={() => setIds(ids.filter((_, other) => other !== index))}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {missing && (
          <Alert tone="warning" title="Shift tidak aktif">
            Pilih pengganti untuk shift yang diarsipkan atau dihapus.
          </Alert>
        )}
        {shifts.data && ids.length < Math.min(10, shifts.data.length) && (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Plus aria-hidden="true" />}
            onClick={() => setIds([...ids, ''])}
          >
            Tambah shift ke siklus
          </Button>
        )}
      </section>

      <section className="rotation-section">
        <h3>Waktu pergantian</h3>
        <fieldset className="rotation-days">
          <legend className="hds-sr-only">Hari pergantian</legend>
          {DAY_SHORT.map((label, index) => (
            <label
              key={label}
              className={dayOfWeek === index + 1 ? 'shift-chip is-selected' : 'shift-chip'}
            >
              <input
                type="radio"
                name={dayName}
                value={index + 1}
                checked={dayOfWeek === index + 1}
                aria-label={DAY_FULL[index]}
                onChange={() => setDayOfWeek(index + 1)}
              />
              <span aria-hidden="true">{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="rotation-time">
          <label className="rotation-field">
            <span>Jam</span>
            <Input
              type="time"
              value={executeTime}
              onChange={(event) => setExecuteTime(event.target.value)}
            />
          </label>
          <label className="rotation-field">
            <span>IANA timezone</span>
            <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
        </div>
      </section>

      {complete && (
        <section className="rotation-section">
          <div className="catalog-section-heading">
            <h3>Setelah pergantian</h3>
            <span>
              Setiap {DAY_FULL[dayOfWeek - 1]} {executeTime}
            </span>
          </div>
          <ul className="rotation-preview">
            {chosen.map((shift, index) => {
              const source = chosen[(index + 1) % chosen.length]!;
              return (
                <li key={shift!.id}>
                  <strong>{shift!.name}</strong>
                  <span className="rotation-preview__from">{label(shift!, mixedZones)}</span>
                  <ArrowRight aria-hidden="true" />
                  <span className="rotation-preview__to">{label(source, mixedZones)}</span>
                </li>
              );
            })}
          </ul>
          {identical && (
            <Alert tone="warning" title="Jadwal shift sama">
              Pilih shift dengan jam yang berbeda.
            </Alert>
          )}
        </section>
      )}

      <div className="rotation-enabled">
        <Switch
          label="Aktifkan jadwal"
          description={enabled ? 'Berjalan otomatis setiap minggu' : 'Disimpan tanpa dijalankan'}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>
    </Dialog>
  );
}

/** Rotation also swaps timezones, so the zone is shown whenever the shifts use different ones. */
function label(shift: ShiftTemplate, withZone: boolean) {
  const hours = scheduleLabel(shift.weeklySchedule);
  return withZone ? `${hours} (${shift.timezone})` : hours;
}
