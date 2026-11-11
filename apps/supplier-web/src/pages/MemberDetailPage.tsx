import {
  ArchiveRestore,
  Camera,
  Check,
  Copy,
  ImageUp,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRoundX,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';

import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Skeleton,
  StatusBadge,
  toast,
} from '@tmmin-henkaten/ui';

import { useFocusTarget } from '../app/focus-target';
import { supplierApi, supplierAssetUrl } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { MasterBackLink, OneTimeCredential, masterMutationProblem } from './MasterDataPages';
import { MemberRoleDialog } from './MemberRoleDialog';
import { memberRoleDescriptions, memberRoleLabels } from './memberRoles';
import './member-detail.css';

type Member = Awaited<ReturnType<typeof supplierApi.member>>;
type Scope = { userId: string; supplierId: string; purpose: string };
type Credential = { username: string; temporaryPassword: string };

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export function MemberDetailPage() {
  const { resourceId } = useParams();
  const { session } = useSession();
  const scope = scopeOf(session!);
  const [credential, setCredential] = useState<Credential | null>(null);
  const detail = useQuery<Member>({
    queryKey: scopedKey(scope, 'master-members-detail', resourceId),
    queryFn: () => supplierApi.member(resourceId!),
  });
  useFocusTarget(Boolean(detail.data));

  if (detail.isLoading) return <MemberDetailSkeleton />;
  if (detail.isError || !detail.data)
    return (
      <div className="product-page">
        <MasterBackLink to="/master-data/members" label="Member & Akun" />
        <ErrorState
          title="Detail member tidak dapat dimuat"
          description=""
          action={<Button onClick={() => void detail.refetch()}>Coba lagi</Button>}
        />
      </div>
    );

  const member = detail.data;
  return (
    <div className="product-page member-detail">
      <MasterBackLink to="/master-data/members" label="Member & Akun" />
      <MemberDetailHeader member={member} />
      {credential && <OneTimeCredential value={credential} onDone={() => setCredential(null)} />}
      <div className="member-detail__layout">
        <div className="member-detail__main">
          <MemberProfilePanel key={member.id} member={member} scope={scope} />
          <MemberPhotoPanel member={member} scope={scope} />
        </div>
        <aside className="member-detail__rail" aria-label="Akun dan status member">
          <MemberAccountPanel member={member} scope={scope} onCredential={setCredential} />
          <MemberStatusPanel member={member} scope={scope} />
        </aside>
      </div>
    </div>
  );
}

function MemberDetailHeader({ member }: { member: Member }) {
  const timeZone = useSession().session?.supplier?.timezone;
  useEffect(() => {
    document.querySelector<HTMLElement>('.member-detail-header h1')?.focus();
  }, [member.id]);
  const account = accountState(member);
  return (
    <header className="product-page-header member-detail-header">
      <div className="member-detail-header__identity">
        <MemberAvatar member={member} size="lg" />
        <div className="member-detail-header__copy">
          <nav className="product-breadcrumbs" aria-label="Breadcrumb">
            <NavLink to="/">Supplier</NavLink>
            <span aria-hidden="true">/</span>
            <NavLink to="/master-data/members">Member &amp; Akun</NavLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{member.fullName}</span>
          </nav>
          <span className="product-eyebrow">Member &amp; Akun</span>
          <div className="product-page-header__title">
            <h1 tabIndex={-1}>{member.fullName}</h1>
          </div>
          <div className="member-detail-header__badges">
            <Badge tone="info">{memberRoleLabels[member.role]}</Badge>
            <StatusBadge tone={member.active ? 'success' : 'neutral'}>
              {member.active ? 'Aktif' : 'Arsip'}
            </StatusBadge>
            <StatusBadge tone={account.tone}>{account.label}</StatusBadge>
          </div>
        </div>
      </div>
      <dl className="member-detail-header__facts">
        {member.registrationNumber && (
          <div>
            <dt>Registrasi</dt>
            <dd className="is-mono">{member.registrationNumber}</dd>
          </div>
        )}
        {member.account && (
          <div>
            <dt>Username</dt>
            <dd className="is-mono">{member.account.username}</dd>
          </div>
        )}
        <div>
          <dt>Diperbarui</dt>
          <dd>
            <time dateTime={member.updatedAt}>{formatTimestamp(member.updatedAt, timeZone)}</time>
          </dd>
        </div>
      </dl>
    </header>
  );
}

function MemberProfilePanel({ member, scope }: { member: Member; scope: Scope }) {
  const queryClient = useQueryClient();
  const saved = useMemo(
    () => ({ fullName: member.fullName, registrationNumber: member.registrationNumber ?? '' }),
    [member.fullName, member.registrationNumber],
  );
  const [values, setValues] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const needsRegistration = member.role !== 'MP';
  const formId = `member-profile-${member.id}`;
  useEffect(() => setValues(saved), [saved]);

  const changes = {
    fullName: values.fullName.trim() !== saved.fullName,
    registrationNumber:
      needsRegistration && values.registrationNumber.trim() !== saved.registrationNumber,
  };
  const dirty = changes.fullName || changes.registrationNumber;
  const valid =
    values.fullName.trim().length > 0 &&
    (!needsRegistration || values.registrationNumber.trim().length > 0);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      supplierApi.updateMember(member.id, {
        expectedVersion: member.version,
        ...(changes.fullName ? { fullName: values.fullName.trim() } : {}),
        ...(changes.registrationNumber
          ? { registrationNumber: values.registrationNumber.trim() }
          : {}),
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(scopedKey(scope, 'master-members-detail', member.id), updated);
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members').slice(0, -1),
      });
      toast.success('Perubahan disimpan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || !valid) return;
    setProblem(null);
    save.mutate();
  };

  return (
    <section className="member-card" aria-labelledby="member-profile-title">
      <header className="member-card__header">
        <h2 id="member-profile-title">Profil</h2>
      </header>
      <div className="member-card__body">
        {problem && (
          <Alert tone="danger" title="Perubahan gagal">
            {problem}
          </Alert>
        )}
        <form id={formId} className="member-profile-form" onSubmit={submit} noValidate>
          <div className="member-profile-form__grid">
            <Field label="Nama lengkap" htmlFor="fullName" required>
              <Input
                id="fullName"
                value={values.fullName}
                maxLength={120}
                autoComplete="off"
                error={!values.fullName.trim()}
                onChange={(event) => setValues({ ...values, fullName: event.target.value })}
                required
              />
            </Field>
            {needsRegistration && (
              <Field label="Nomor registrasi" htmlFor="registrationNumber" required>
                <Input
                  id="registrationNumber"
                  className="is-mono"
                  value={values.registrationNumber}
                  maxLength={64}
                  autoComplete="off"
                  error={!values.registrationNumber.trim()}
                  onChange={(event) =>
                    setValues({ ...values, registrationNumber: event.target.value })
                  }
                  required
                />
              </Field>
            )}
          </div>
        </form>
        {/* The role dialog portals its own controls, so it stays outside the profile form. */}
        <div className="member-role-field" role="group" aria-labelledby="member-role-label">
          <span id="member-role-label" className="hds-field__label">
            Role
          </span>
          <div className="member-role-field__value">
            <span className="member-role-field__icon" aria-hidden="true">
              <ShieldCheck />
            </span>
            <span className="member-role-field__copy">
              <strong>{memberRoleLabels[member.role]}</strong>
              <small>{memberRoleDescriptions[member.role]}</small>
            </span>
            <MemberRoleDialog member={member} scope={scope} />
          </div>
        </div>
      </div>
      <footer
        className={`member-card__footer member-profile-form__actions${dirty ? ' is-dirty' : ''}`}
      >
        <span className="member-profile-form__state" aria-live="polite">
          {dirty ? (
            <>
              <span className="member-dot" aria-hidden="true" />
              Perubahan belum disimpan
            </>
          ) : (
            <>
              <Check aria-hidden="true" />
              Tersimpan
            </>
          )}
        </span>
        <div className="member-profile-form__buttons">
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<RotateCcw />}
            disabled={!dirty || save.isPending}
            onClick={() => {
              setValues(saved);
              setProblem(null);
            }}
          >
            Batalkan
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={!dirty || !valid}>
            Simpan perubahan
          </Button>
        </div>
      </footer>
    </section>
  );
}

export function MemberPhotoPanel({ member, scope }: { member: Member; scope: Scope }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members-detail', member.id),
      }),
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members').slice(0, -1),
      }),
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'assignment-board').slice(0, -1),
      }),
    ]);
  const upload = useMutation({
    mutationFn: (file: File) => supplierApi.uploadMemberPhoto(member.id, file),
    onSuccess: async (updated) => {
      queryClient.setQueryData(scopedKey(scope, 'master-members-detail', member.id), updated);
      setNotice(member.photo ? 'Foto berhasil diganti.' : 'Foto berhasil diset.');
      await invalidate();
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const remove = useMutation({
    mutationFn: () => supplierApi.removeMemberPhoto(member.id, member.photo!.version),
    onSuccess: async () => {
      setNotice('Foto berhasil dihapus. Initials kembali digunakan sebagai avatar.');
      await invalidate();
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const pending = upload.isPending || remove.isPending;

  const accept = (file: File | undefined) => {
    setProblem(null);
    setNotice(null);
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setProblem('Format foto harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setProblem('Ukuran foto maksimal 2 MB.');
      return;
    }
    upload.mutate(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!pending) accept(event.dataTransfer.files[0]);
  };

  return (
    <section className="member-card" aria-labelledby="member-photo-title">
      <header className="member-card__header">
        <h2 id="member-photo-title">Foto</h2>
        <span className="member-card__hint">JPG, PNG, atau WebP · maks. 2 MB</span>
      </header>
      <div className="member-card__body">
        {problem && (
          <Alert tone="danger" title="Foto tidak dapat diproses">
            {problem}
          </Alert>
        )}
        {notice && (
          <Alert tone="success" title="Foto member diperbarui">
            {notice}
          </Alert>
        )}
        <div
          className={`member-photo${dragging ? ' is-dragging' : ''}${pending ? ' is-pending' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!pending) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="member-photo__preview">
            <MemberAvatar member={member} size="xl" />
          </div>
          <div className="member-photo__content">
            <strong>{member.photo ? 'Foto member aktif' : 'Foto belum diset'}</strong>
            <span className="member-photo__drop">
              <ImageUp aria-hidden="true" />
              {dragging ? 'Lepaskan untuk mengunggah' : 'Seret foto ke area ini atau pilih file'}
            </span>
            <div className="member-photo__actions">
              <label className={`photo-upload${pending ? ' is-disabled' : ''}`}>
                <Camera aria-hidden="true" />
                {upload.isPending ? 'Mengunggah…' : member.photo ? 'Ganti foto' : 'Set foto'}
                <input
                  type="file"
                  accept={PHOTO_TYPES.join(',')}
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    accept(file);
                  }}
                />
              </label>
              {member.photo && (
                <Button
                  variant="ghost"
                  className="member-photo__remove"
                  leadingIcon={<Trash2 />}
                  loading={remove.isPending}
                  disabled={pending}
                  onClick={() => {
                    setProblem(null);
                    setNotice(null);
                    if (
                      window.confirm('Hapus foto member ini dan gunakan initials sebagai avatar?')
                    )
                      remove.mutate();
                  }}
                >
                  Hapus foto
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MemberAccountPanel({
  member,
  scope,
  onCredential,
}: {
  member: Member;
  scope: Scope;
  onCredential: (credential: Credential | null) => void;
}) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const account = member.account;
  const action = useMutation({
    mutationFn: async (kind: 'activate' | 'reset') => {
      const result =
        kind === 'activate'
          ? await supplierApi.memberAccountAction(member.id, 'activate', {
              expectedVersion: account!.version,
            })
          : await supplierApi.resetMemberPassword(member.id, {
              expectedVersion: account!.version,
            });
      onCredential(result.credential ?? null);
    },
    onSuccess: async (_, kind) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scopedKey(scope, 'master-members-detail', member.id),
        }),
        queryClient.invalidateQueries({
          queryKey: scopedKey(scope, 'master-members').slice(0, -1),
        }),
      ]);
      toast.success(kind === 'activate' ? 'Akun diaktifkan' : 'Password berhasil direset');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const state = accountState(member);

  return (
    <section
      className="member-card focus-target-frame"
      data-focus-target="account"
      aria-labelledby="member-account-title"
    >
      <header className="member-card__header">
        <h2 id="member-account-title">Akun</h2>
        {account && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
      </header>
      <div className="member-card__body">
        {problem && (
          <Alert tone="danger" title="Perubahan akun gagal">
            {problem}
          </Alert>
        )}
        {account ? (
          <>
            <dl className="member-facts">
              <div>
                <dt>Username</dt>
                <dd>
                  <span className="is-mono">{account.username}</span>
                  <button
                    type="button"
                    className="member-copy"
                    aria-label={`Salin username ${account.username}`}
                    onClick={() => {
                      void navigator.clipboard?.writeText(account.username);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1600);
                    }}
                  >
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                </dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>{account.mustChangePassword ? 'Sementara' : 'Sudah diganti'}</dd>
              </div>
            </dl>
            {account.status === 'ACTIVE' ? (
              <AlertDialog
                title="Reset password member?"
                description="Password sementara yang baru akan ditampilkan satu kali."
                confirmLabel="Reset password"
                onConfirm={() => {
                  setProblem(null);
                  action.mutate('reset');
                }}
                trigger={
                  <Button
                    variant="secondary"
                    className="member-card__action"
                    leadingIcon={<KeyRound />}
                    loading={action.isPending}
                  >
                    Reset password
                  </Button>
                }
              />
            ) : (
              <>
                {!member.active && (
                  <p className="member-card__note">Pulihkan member sebelum mengaktifkan akun.</p>
                )}
                <AlertDialog
                  title="Aktifkan akun member?"
                  description="Password sementara baru akan ditampilkan. Member perlu mengganti password saat login."
                  confirmLabel="Aktifkan akun"
                  onConfirm={() => {
                    setProblem(null);
                    action.mutate('activate');
                  }}
                  trigger={
                    <Button
                      className="member-card__action"
                      leadingIcon={<ShieldCheck />}
                      disabled={!member.active || action.isPending}
                      loading={action.isPending}
                      data-focus-initial
                    >
                      Aktifkan akun
                    </Button>
                  }
                />
              </>
            )}
          </>
        ) : (
          <div className="member-empty-account">
            <UserRoundX aria-hidden="true" />
            <span>Tanpa akun login</span>
          </div>
        )}
      </div>
    </section>
  );
}

function MemberStatusPanel({ member, scope }: { member: Member; scope: Scope }) {
  const timeZone = useSession().session?.supplier?.timezone;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: () =>
      supplierApi.memberAction(member.id, member.active ? 'deactivate' : 'activate', {
        expectedVersion: member.version,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: scopedKey(scope, 'master-members-detail', member.id),
        }),
        queryClient.invalidateQueries({
          queryKey: scopedKey(scope, 'master-members').slice(0, -1),
        }),
      ]);
      toast.success(member.active ? 'Member dipindahkan ke arsip' : 'Member diaktifkan');
      if (member.active) void navigate('/master-data/members', { replace: true });
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <section
      className="member-card focus-target-frame"
      data-focus-target="status"
      aria-labelledby="member-status-title"
    >
      <header className="member-card__header">
        <h2 id="member-status-title">Status member</h2>
        <StatusBadge tone={member.active ? 'success' : 'neutral'}>
          {member.active ? 'Aktif' : 'Arsip'}
        </StatusBadge>
      </header>
      <div className="member-card__body">
        {problem && (
          <Alert tone="danger" title="Perubahan member gagal">
            {problem}
          </Alert>
        )}
        <dl className="member-facts">
          <div>
            <dt>Ditambahkan</dt>
            <dd>
              <time dateTime={member.createdAt}>{formatTimestamp(member.createdAt, timeZone)}</time>
            </dd>
          </div>
        </dl>
        <AlertDialog
          title={member.active ? 'Hapus member dari daftar aktif?' : 'Pulihkan member?'}
          description={
            member.active
              ? `${member.fullName} akan dipindahkan ke Arsip. Riwayatnya tetap tersedia.`
              : `${member.fullName} akan kembali ke daftar member aktif.`
          }
          confirmLabel={member.active ? 'Hapus member' : 'Pulihkan member'}
          destructive={member.active}
          onConfirm={() => {
            setProblem(null);
            toggle.mutate();
          }}
          trigger={
            <Button
              variant="secondary"
              className={`member-card__action${member.active ? ' member-card__action--danger' : ''}`}
              leadingIcon={member.active ? <Trash2 /> : <ArchiveRestore />}
              loading={toggle.isPending}
              data-focus-initial
            >
              {member.active ? 'Hapus member' : 'Pulihkan member'}
            </Button>
          }
        />
      </div>
    </section>
  );
}

export function MemberAvatar({ member, size }: { member: Member; size: 'lg' | 'xl' }) {
  const src = member.photo ? supplierAssetUrl(member.photo.thumbnailUrl) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span className={`member-avatar member-avatar--${size}`}>
      {src && failedSrc !== src ? (
        <img src={src} alt={`Foto ${member.fullName}`} onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-label={`Initials ${member.fullName}`}>{member.initials}</span>
      )}
    </span>
  );
}

function MemberDetailSkeleton() {
  return (
    <div className="product-page member-detail" aria-busy="true">
      <Skeleton className="member-skeleton member-skeleton--link" />
      <div className="member-detail-header member-skeleton-header">
        <Skeleton className="member-skeleton member-skeleton--avatar" />
        <div>
          <Skeleton className="member-skeleton member-skeleton--title" />
          <Skeleton className="member-skeleton member-skeleton--line" />
        </div>
      </div>
      <div className="member-detail__layout">
        <div className="member-detail__main">
          <Skeleton className="member-skeleton member-skeleton--card" />
          <Skeleton className="member-skeleton member-skeleton--card-sm" />
        </div>
        <div className="member-detail__rail">
          <Skeleton className="member-skeleton member-skeleton--card-sm" />
          <Skeleton className="member-skeleton member-skeleton--card-sm" />
        </div>
      </div>
    </div>
  );
}

function accountState(member: Member): {
  label: string;
  tone: 'success' | 'warning' | 'neutral';
} {
  if (!member.account) return { label: 'Tanpa akun', tone: 'neutral' };
  return member.account.status === 'ACTIVE'
    ? { label: 'Akun aktif', tone: 'success' }
    : { label: 'Akun nonaktif', tone: 'warning' };
}

function formatTimestamp(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    ...(timeZone ? { timeZone } : {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function scopeOf(session: NonNullable<ReturnType<typeof useSession>['session']>): Scope {
  return {
    userId: session.principal.userId,
    supplierId: session.supplier!.id,
    purpose: session.principal.purpose,
  };
}
