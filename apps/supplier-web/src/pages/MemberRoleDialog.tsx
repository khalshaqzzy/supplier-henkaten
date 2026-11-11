import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, Check, RefreshCw } from 'lucide-react';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { ChangeMemberRoleRequest, MemberRolePreview } from '@tmmin-henkaten/contracts';
import { Alert, Button, Dialog, Field, Select, toast } from '@tmmin-henkaten/ui';
import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import './member-role.css';

type Member = Awaited<ReturnType<typeof supplierApi.member>>;
type Role = ChangeMemberRoleRequest['role'];
const labels: Record<Role, string> = {
  LINE_LEADER: 'Line Leader',
  SUPERVISOR: 'Supervisor',
  QC: 'QC',
};
const descriptions: Record<Role, string> = {
  LINE_LEADER: 'Input dan tindak lanjut Henkaten',
  SUPERVISOR: 'Approval sesuai penugasan',
  QC: 'Approval kualitas supplier',
};

export function MemberRoleDialog({
  member,
  scope,
}: {
  member: Member;
  scope: { userId: string; supplierId: string; purpose: string };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [review, setReview] = useState<MemberRolePreview | null>(null);
  const [replacementMemberId, setReplacementMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'choose' | 'assign' | 'review'>('choose');
  const [problem, setProblem] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [stale, setStale] = useState(false);
  const pendingRequest = useRef<{ body: ChangeMemberRoleRequest; key: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const refresh = useMutation({
    mutationFn: () => supplierApi.previewMemberRole(member.id, role!),
    onSuccess: (data) => {
      setReview(data);
      setReplacementMemberId('');
      setStale(false);
      setProblem(null);
      setStage(data.dependencies.length || data.blockers.length ? 'assign' : 'review');
    },
    onError: (error) => {
      setProblem(message(error));
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });
  const save = useMutation({
    mutationFn: () => {
      if (!pendingRequest.current) {
        pendingRequest.current = {
          key: crypto.randomUUID(),
          body: {
            role: role!,
            revision: review!.revision,
            reason: reason.trim(),
            handovers: review!.dependencies.map((d) => ({
              kind: d.kind,
              id: d.id,
              replacementMemberId,
            })),
          },
        };
      }
      const request = pendingRequest.current;
      return supplierApi.changeMemberRole(member.id, request.body, request.key);
    },
    onSuccess: async () => {
      pendingRequest.current = null;
      setUncertain(false);
      setOpen(false);
      toast.success('Role member diperbarui');
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, '').slice(0, 4) });
    },
    onError: (error) => {
      const definitive = error instanceof ApiProblemError && error.problem.status < 500;
      if (definitive) {
        pendingRequest.current = null;
        setStale(true);
      } else setUncertain(true);
      setProblem(
        definitive
          ? message(error)
          : 'Hasil penyimpanan belum diketahui. Periksa kembali dengan permintaan yang sama.',
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    },
  });
  if (member.role === 'MP') return null;
  const locked = save.isPending || uncertain;
  const replacement = review?.candidates.find((c) => c.id === replacementMemberId && c.available);
  const canReview =
    review && (!review.dependencies.length || replacement) && !review.blockers.length && !stale;
  const openDialog = (value: boolean) => {
    if (locked) return;
    setOpen(value);
    if (value) {
      setRole(null);
      setReview(null);
      setStage('choose');
      setReason('');
      setProblem(null);
      setStale(false);
      setReplacementMemberId('');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={openDialog}
      size="lg"
      className="member-role-dialog"
      dismissible={!locked && !refresh.isPending}
      title="Ubah role member"
      description="Pilih role baru dan tinjau pengalihan tanggung jawab."
      trigger={
        <Button variant="secondary" leadingIcon={<ArrowRightLeft />}>
          Ubah role
        </Button>
      }
      footer={
        <>
          <span className="member-role-dialog__footer-note">
            {stage === 'choose'
              ? '1 dari 3 · Role baru'
              : stage === 'assign'
                ? '2 dari 3 · Pengalihan'
                : '3 dari 3 · Tinjauan'}
          </span>
          <div className="member-role-dialog__footer-actions">
            <Button
              variant="secondary"
              disabled={locked || refresh.isPending}
              onClick={() =>
                stage === 'choose'
                  ? openDialog(false)
                  : setStage(
                      stage === 'review' && review?.dependencies.length ? 'assign' : 'choose',
                    )
              }
            >
              {stage === 'choose' ? 'Batal' : 'Kembali'}
            </Button>
            {stale ? (
              <Button
                variant="primary"
                leadingIcon={<RefreshCw />}
                loading={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                Muat ulang tinjauan
              </Button>
            ) : stage === 'choose' ? (
              <Button
                variant="primary"
                disabled={!role}
                loading={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                Tinjau tanggung jawab
              </Button>
            ) : stage === 'assign' ? (
              <Button variant="primary" disabled={!canReview} onClick={() => setStage('review')}>
                Tinjau perubahan
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!canReview || !reason.trim()}
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                {uncertain ? 'Periksa hasil penyimpanan' : 'Simpan perubahan role'}
              </Button>
            )}
          </div>
        </>
      }
    >
      <div className="member-role-identity">
        <span className="member-role-avatar">{member.initials}</span>
        <div>
          <strong>{member.fullName}</strong>
          <p>
            {member.registrationNumber} <span aria-hidden="true">·</span> {member.account?.username}
          </p>
        </div>
        <span className="member-role-current">{labels[member.role]}</span>
      </div>
      <ol className="member-role-steps" aria-label="Tahapan perubahan role">
        {['Role baru', 'Pengalihan', 'Tinjauan'].map((name, i) => (
          <li
            key={name}
            aria-current={['choose', 'assign', 'review'][i] === stage ? 'step' : undefined}
          >
            <span>{i + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      {problem && (
        <div ref={errorRef} tabIndex={-1}>
          <Alert
            title={uncertain ? 'Periksa hasil perubahan' : 'Perubahan belum disimpan'}
            tone="danger"
          >
            {problem}
          </Alert>
        </div>
      )}
      {stage === 'choose' && (
        <fieldset className="member-role-options" disabled={refresh.isPending || locked}>
          <legend>Role baru</legend>
          {(Object.keys(labels) as Role[])
            .filter((r) => r !== member.role)
            .map((r) => (
              <label key={r} className={role === r ? 'is-selected' : ''}>
                <input
                  type="radio"
                  name="member-role"
                  value={r}
                  checked={role === r}
                  onChange={() => {
                    setRole(r);
                    setReview(null);
                    setStale(false);
                    setProblem(null);
                  }}
                />
                <span>
                  <strong>{labels[r]}</strong>
                  <small>{descriptions[r]}</small>
                </span>
              </label>
            ))}
        </fieldset>
      )}
      {stage === 'assign' && review && (
        <section className="member-role-transfer">
          <div className="member-role-section-heading">
            <h3>Alihkan tanggung jawab</h3>
          </div>
          {review.blockers.map((b) => (
            <Alert key={b} tone="warning" title="Pengalihan belum tersedia">
              {b}
            </Alert>
          ))}
          {review.dependencies.length > 0 && review.dependencies.length <= 1000 && (
            <>
              <p className="member-role-help">
                Pilih satu {labels[member.role]} pengganti untuk seluruh tanggung jawab terkait.
              </p>
              <div className="member-role-transfer-row">
                <div>
                  <strong>Seluruh assignment dan Henkaten</strong>
                  <p>Dialihkan ke pengganti yang sama.</p>
                </div>
                <Field label="Pengganti" htmlFor="role-replacement" required>
                  <Select
                    id="role-replacement"
                    value={replacementMemberId}
                    placeholder="Pilih pengganti"
                    searchPlaceholder="Cari nama atau registrasi…"
                    onValueChange={setReplacementMemberId}
                    options={review.candidates.map((c) => ({
                      value: c.id,
                      label: c.fullName,
                      meta: c.registrationNumber ?? undefined,
                      ...(c.available
                        ? {}
                        : { disabledReason: c.unavailableReason ?? 'Tidak tersedia' }),
                    }))}
                  />
                </Field>
              </div>
            </>
          )}
          {review.pendingQcCount > 0 && (
            <p className="member-role-help">
              {review.pendingQcCount} approval QC tertunda tetap tersedia untuk QC aktif lainnya.
            </p>
          )}
        </section>
      )}
      {stage === 'review' && review && (
        <section>
          <h3 className="member-role-review-title">Tinjau perubahan</h3>
          <div className="member-role-comparison">
            <span>{labels[member.role]}</span>
            <ArrowRight aria-hidden="true" />
            <strong>{labels[review.role]}</strong>
          </div>
          <dl className="member-role-summary">
            {review.dependencies.length > 0 && (
              <div>
                <dt>Pengganti seluruh tanggung jawab</dt>
                <dd>{replacement?.fullName}</dd>
              </div>
            )}
            <div>
              <dt>Status member</dt>
              <dd>{member.active ? 'Aktif' : 'Arsip'}</dd>
            </div>
            <div>
              <dt>Status akun</dt>
              <dd>{member.account?.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</dd>
            </div>
          </dl>
          <Field label="Alasan perubahan" htmlFor="role-reason" required>
            <textarea
              id="role-reason"
              className="member-role-reason"
              value={reason}
              maxLength={500}
              disabled={locked}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: perubahan penugasan menjadi Supervisor"
              rows={3}
            />
          </Field>
          <p className="member-role-consequence">
            <Check aria-hidden="true" /> Nomor registrasi dan username tetap sama.
          </p>
          <p className="member-role-help">
            {member.account?.status === 'ACTIVE'
              ? 'Member perlu login kembali setelah role berubah.'
              : 'Akun tetap nonaktif. Aktifkan akun secara terpisah agar member dapat login.'}
          </p>
        </section>
      )}
    </Dialog>
  );
}
function message(error: unknown) {
  return error instanceof ApiProblemError
    ? error.problem.detail
    : 'Tinjauan tidak dapat dimuat. Coba kembali.';
}
