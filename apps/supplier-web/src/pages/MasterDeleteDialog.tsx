import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArrowUpRight,
  Briefcase,
  CalendarSync,
  Check,
  CircleAlert,
  KeyRound,
  LayoutGrid,
  RefreshCw,
  Trash2,
  Unlink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiProblemError, type MasterDeleteTarget } from '@tmmin-henkaten/api-client';
import type {
  MasterDeleteMode,
  MasterDeletePreview,
  MasterDeleteResult,
} from '@tmmin-henkaten/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  ErrorState,
  FourMIndicator,
  Skeleton,
  toast,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import './catalog-actions.css';
import './master-delete.css';

const nouns: Record<MasterDeleteTarget['kind'], string> = {
  LINE: 'line',
  JOB: 'job',
  MEMBER: 'member',
  PART: 'part',
  SHIFT_TEMPLATE: 'shift',
};

export interface MasterDeleteDialogProps {
  target: MasterDeleteTarget;
  /** Mode selected when the dialog opens; archived records always start on PERMANENT. */
  initialMode?: MasterDeleteMode;
  onClose: () => void;
  onDeleted: (result: MasterDeleteResult) => void | Promise<void>;
}

export function MasterDeleteDialog({
  target,
  initialMode = 'ARCHIVE',
  onClose,
  onDeleted,
}: MasterDeleteDialogProps) {
  const { session } = useSession();
  const scope = {
    userId: session!.principal.userId,
    supplierId: session!.supplier!.id,
    purpose: session!.principal.purpose,
  };
  const [mode, setMode] = useState<MasterDeleteMode>(initialMode);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const preview = useQuery({
    queryKey: scopedKey(scope, 'master-delete-preview', target),
    queryFn: () => supplierApi.deletePreview(target),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const data = preview.data;
  useEffect(() => {
    if (data && !data.canArchive && data.canDelete) setMode('PERMANENT');
  }, [data]);
  // Consent applies to the mode and impact on screen; a refreshed preview needs it again.
  useEffect(() => setConsent(false), [mode, data]);

  const remove = useMutation({
    mutationFn: () =>
      supplierApi.deleteMaster(target, { expectedVersion: data!.resource.version, mode }),
    onSuccess: async (result) => {
      toast.success(
        result.mode === 'ARCHIVE'
          ? `${capitalize(nouns[target.kind])} diarsipkan`
          : `${capitalize(nouns[target.kind])} dihapus permanen`,
      );
      await onDeleted(result);
    },
    onError: (error) => {
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Hasil belum dapat dipastikan. Muat ulang untuk memeriksa status data.',
      );
      setConsent(false);
      void preview.refetch();
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });

  const blocked = Boolean(data && data.openHenkatenTotal > 0);
  const noun = nouns[target.kind];
  const busy = remove.isPending;
  const title = blocked
    ? `${capitalize(noun)} belum bisa dihapus`
    : data && !data.resource.active
      ? `Hapus permanen ${noun}?`
      : `Hapus ${noun}?`;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      dismissible={!busy}
      className={`catalog-delete-dialog master-delete-dialog${
        !blocked && mode === 'ARCHIVE' ? ' master-delete-dialog--archive' : ''
      }`}
      title={title}
      {...(data ? { description: data.resource.label } : {})}
      headerAdornment={
        blocked ? (
          <CircleAlert aria-hidden="true" />
        ) : mode === 'ARCHIVE' ? (
          <Archive aria-hidden="true" />
        ) : (
          <Trash2 aria-hidden="true" />
        )
      }
      footer={
        blocked ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Tutup
            </Button>
            <Button
              variant="primary"
              leadingIcon={<RefreshCw aria-hidden="true" />}
              loading={preview.isFetching}
              onClick={() => {
                setProblem(null);
                void preview.refetch();
              }}
            >
              Periksa lagi
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Batal
            </Button>
            <Button
              variant={mode === 'ARCHIVE' ? 'primary' : 'danger'}
              loading={busy}
              disabled={!data || !consent || preview.isFetching}
              leadingIcon={
                mode === 'ARCHIVE' ? <Archive aria-hidden="true" /> : <Trash2 aria-hidden="true" />
              }
              onClick={() => {
                setProblem(null);
                remove.mutate();
              }}
            >
              {mode === 'ARCHIVE' ? 'Arsipkan' : 'Hapus permanen'}
            </Button>
          </>
        )
      }
    >
      {problem && (
        <div ref={errorRef} tabIndex={-1}>
          <Alert tone="danger" title="Data belum dihapus">
            {problem}
          </Alert>
        </div>
      )}
      {preview.isPending ? (
        <div className="master-delete__loading" aria-label="Memuat dampak penghapusan">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : preview.isError ? (
        <ErrorState
          title="Dampak penghapusan tidak dapat dimuat"
          description="Muat ulang sebelum menghapus."
          action={<Button onClick={() => void preview.refetch()}>Coba lagi</Button>}
        />
      ) : blocked ? (
        <BlockingHenkatens preview={preview.data} />
      ) : (
        <>
          <ModePicker
            kind={target.kind}
            mode={mode}
            onChange={setMode}
            canArchive={preview.data.canArchive}
            archived={!preview.data.resource.active}
            disabled={busy}
          />
          <ImpactSummary preview={preview.data} mode={mode} />
          <div className="master-delete__consent">
            <Checkbox
              checked={consent}
              disabled={busy}
              onCheckedChange={(next) => setConsent(next === true)}
              label={
                mode === 'ARCHIVE'
                  ? `Saya mengerti ${noun} ini akan diarsipkan.`
                  : `Saya mengerti ${noun} ini akan dihapus permanen dan tidak dapat dipulihkan.`
              }
            />
          </div>
        </>
      )}
    </Dialog>
  );
}

/** What a permanent delete frees for reuse, per kind. Shift Templates reserve nothing visible. */
const reusable: Record<MasterDeleteTarget['kind'], string | null> = {
  LINE: 'Kode line',
  JOB: 'Nama job',
  MEMBER: 'No. registrasi & username',
  PART: 'Part number',
  SHIFT_TEMPLATE: null,
};

function ModePicker({
  kind,
  mode,
  onChange,
  canArchive,
  archived,
  disabled,
}: {
  kind: MasterDeleteTarget['kind'];
  mode: MasterDeleteMode;
  onChange: (mode: MasterDeleteMode) => void;
  canArchive: boolean;
  archived: boolean;
  disabled: boolean;
}) {
  const name = useId();
  const options: Array<{
    value: MasterDeleteMode;
    icon: ReactNode;
    title: string;
    points: string[];
    unavailable?: string;
  }> = [
    {
      value: 'ARCHIVE',
      icon: <Archive aria-hidden="true" />,
      title: 'Arsipkan',
      points: [
        'Dapat diaktifkan kembali',
        ...(reusable[kind] ? [`${reusable[kind]} tetap terpakai`] : []),
      ],
      ...(canArchive ? {} : { unavailable: archived ? 'Sudah diarsipkan' : 'Tidak tersedia' }),
    },
    {
      value: 'PERMANENT',
      icon: <Trash2 aria-hidden="true" />,
      title: 'Hapus permanen',
      points: [
        'Tidak dapat dipulihkan',
        ...(reusable[kind] ? [`${reusable[kind]} dapat dipakai lagi`] : []),
        'Riwayat Henkaten tetap ada',
      ],
    },
  ];
  return (
    <fieldset className="master-delete__modes">
      <legend>Cara menghapus</legend>
      {options.map((option) => {
        const unavailable = Boolean(option.unavailable);
        const selected = mode === option.value;
        return (
          <label
            key={option.value}
            className={[
              'master-delete__mode',
              `master-delete__mode--${option.value.toLowerCase()}`,
              selected && 'is-selected',
              (unavailable || disabled) && 'is-disabled',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={unavailable || disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="master-delete__mode-icon">{option.icon}</span>
            <span className="master-delete__mode-body">
              <strong>{option.title}</strong>
              {option.unavailable ? (
                <small className="master-delete__mode-status">{option.unavailable}</small>
              ) : (
                <ul>
                  {option.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </span>
            <span className="master-delete__mode-check" aria-hidden="true">
              <Check />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ImpactSummary({
  preview,
  mode,
}: {
  preview: MasterDeletePreview;
  mode: MasterDeleteMode;
}) {
  const { impact } = preview;
  const rows: Array<{
    key: string;
    icon: ReactNode;
    label: string;
    detail?: string;
    value: ReactNode;
  }> = [];
  if (impact.jobs > 0)
    rows.push({
      key: 'jobs',
      icon: <Briefcase aria-hidden="true" />,
      label: mode === 'ARCHIVE' ? 'Job diarsipkan' : 'Job dihapus',
      value: impact.jobs,
    });
  if (impact.lineShifts > 0)
    rows.push({
      key: 'line-shifts',
      icon: <Unlink aria-hidden="true" />,
      label: 'Line–Shift dilepas',
      ...(impact.lineShiftLabels.length ? { detail: impact.lineShiftLabels.join(', ') } : {}),
      value: impact.lineShifts,
    });
  if (impact.clearedAssignments > 0)
    rows.push({
      key: 'assignments',
      icon: <Unlink aria-hidden="true" />,
      label: 'Assignment dikosongkan',
      value: impact.clearedAssignments,
    });
  if (impact.rotationSchedules.length > 0)
    rows.push({
      key: 'rotations',
      icon: <CalendarSync aria-hidden="true" />,
      label: 'Jadwal rotasi diperbarui',
      value: impact.rotationSchedules.map(({ name }) => name).join(', '),
    });
  if (impact.accountUsername)
    rows.push({
      key: 'account',
      icon: <KeyRound aria-hidden="true" />,
      label: 'Akun dinonaktifkan',
      value: impact.accountUsername,
    });
  if (impact.boardLayout && mode === 'PERMANENT')
    rows.push({
      key: 'layout',
      icon: <LayoutGrid aria-hidden="true" />,
      label: 'Layout board dihapus',
      value: 'Ya',
    });
  return (
    <section className="master-delete__impact" aria-label="Dampak">
      <h3>Dampak</h3>
      {rows.length === 0 ? (
        <p className="master-delete__impact-empty">
          <Check aria-hidden="true" /> Tidak ada data lain yang terdampak.
        </p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.key}>
              <span className="master-delete__impact-icon">{row.icon}</span>
              <span className="master-delete__impact-label">
                {row.label}
                {row.detail && <small>{row.detail}</small>}
              </span>
              <strong>{row.value}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BlockingHenkatens({ preview }: { preview: MasterDeletePreview }) {
  const remaining = preview.openHenkatenTotal - preview.openHenkatens.length;
  return (
    <section className="master-delete__blockers">
      <Alert tone="danger" title={`${preview.openHenkatenTotal} Henkaten masih Open`}>
        Tutup Henkaten berikut terlebih dahulu, lalu periksa lagi.
      </Alert>
      <ul>
        {preview.openHenkatens.map((item) => (
          <li key={item.id}>
            <Link to={`/henkatens/${item.id}`} target="_blank" rel="noopener">
              <FourMIndicator category={item.category} />
              <span className="master-delete__blocker-body">
                <strong>{item.identifier}</strong>
                <small>
                  {[item.lineCode, item.shiftName, item.jobName].filter(Boolean).join(' · ')}
                </small>
              </span>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <ArrowUpRight aria-hidden="true" className="master-delete__blocker-open" />
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 && <p className="master-delete__more">+{remaining} Henkaten lainnya</p>}
    </section>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
