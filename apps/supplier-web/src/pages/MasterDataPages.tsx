import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clipboard,
  Database,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  Alert,
  AlertDialog,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  NativeSelect,
  Panel,
  Skeleton,
  toast,
} from '@tmmin-henkaten/ui';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { supplierApi, supplierAssetUrl } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { CursorPager } from '../components/CursorPager';
import { PageHeader } from '../components/layout';

const resources = {
  members: {
    title: 'Member & Akun',
    description: '',
    createLabel: 'Tambah member',
    columns: ['Member', 'Registrasi', 'Role', 'Username', 'Akun', 'Status'],
  },
  lines: {
    title: 'Line & Job',
    description: '',
    createLabel: 'Tambah line',
    columns: ['Line', 'Nama', 'Urutan', 'Status'],
  },
  parts: {
    title: 'Part',
    description: '',
    createLabel: 'Tambah part',
    columns: ['Part number', 'Nama part', 'Status'],
  },
  shifts: {
    title: 'Shift Template',
    description: '',
    createLabel: 'Tambah template',
    columns: ['Template', 'Jam', 'Timezone', 'Status'],
  },
} as const;

export function MasterBackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="master-back-link" to={to}>
      <ArrowLeft aria-hidden="true" /> Kembali ke {label}
    </Link>
  );
}

type ResourceKind = keyof typeof resources;

export function MasterDataOverviewPage() {
  const cards = [
    ['Member & Akun', '', '/master-data/members'],
    ['Line & Job', '', '/master-data/lines'],
    ['Part', '', '/master-data/parts'],
    ['Shift Template', '', '/master-data/shifts'],
    ['Checklist 4M', '', '/master-data/checklists'],
    ['Line Setup', '', '/master-data/line-setup'],
  ] as const;
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Konfigurasi Supplier"
        title="Master Data"
        description=""
        actions={
          <Link className="hds-button hds-button--secondary hds-button--md" to="/setup">
            Lihat readiness
          </Link>
        }
      />
      <section className="master-overview">
        {cards.map(([title, description, to]) => (
          <Link key={to} to={to}>
            <span>
              <Database aria-hidden="true" />
            </span>
            <div>
              <strong>{title}</strong>
              {description && <small>{description}</small>}
            </div>
            <ArrowRight aria-hidden="true" />
          </Link>
        ))}
      </section>
    </div>
  );
}

export function MasterListPage({ kind }: { kind: ResourceKind }) {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const active = (params.get('active') ?? 'ACTIVE') as 'ALL' | 'ACTIVE' | 'INACTIVE';
  const cursor = params.get('cursor') ?? undefined;
  const scope = scopeOf(session!);
  const query = useQuery<MasterPage>({
    queryKey: scopedKey(scope, `master-${kind}`, { search, active, cursor }),
    queryFn: async () => {
      const listQuery = {
        limit: 25,
        active,
        ...(cursor ? { cursor } : {}),
        ...(search ? { search } : {}),
      };
      const result =
        kind === 'members'
          ? await supplierApi.members(listQuery)
          : kind === 'lines'
            ? await supplierApi.lines(listQuery)
            : kind === 'parts'
              ? await supplierApi.parts(listQuery)
              : await supplierApi.shiftTemplates(listQuery);
      return result;
    },
  });
  const meta = resources[kind];
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    setParams(next, { replace: true });
  };

  return (
    <div className="product-page">
      <MasterBackLink to="/master-data" label="Master Data" />
      <PageHeader
        eyebrow="Master Data"
        title={meta.title}
        description={meta.description}
        actions={
          <div className="master-header-actions">
            {kind === 'parts' && (
              <Link
                className="hds-button hds-button--secondary hds-button--md"
                to="/master-data/parts/import"
              >
                Import CSV / Excel
              </Link>
            )}
            <Link
              className="hds-button hds-button--primary hds-button--md"
              to={`/master-data/${kind}/new`}
            >
              <Plus aria-hidden="true" />
              {meta.createLabel}
            </Link>
          </div>
        }
      />
      <FilterBar>
        <label className="filter-search">
          <span>Cari</span>
          <Input
            value={search}
            placeholder="Ketik nama atau kode"
            onChange={(event) => update('search', event.target.value)}
          />
        </label>
        <label>
          <span>Status</span>
          <NativeSelect value={active} onChange={(event) => update('active', event.target.value)}>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">{kind === 'members' ? 'Arsip' : 'Nonaktif'}</option>
            <option value="ALL">Semua</option>
          </NativeSelect>
        </label>
      </FilterBar>
      {query.isLoading && <TableSkeleton />}
      {query.isError && (
        <ErrorState
          title={`${meta.title} tidak dapat dimuat`}
          description=""
          action={<Button onClick={() => void query.refetch()}>Coba lagi</Button>}
        />
      )}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title={search ? 'Tidak ada hasil filter' : `Belum ada ${meta.title.toLowerCase()}`}
          description={
            search
              ? 'Ubah atau bersihkan kata pencarian.'
              : 'Tambahkan satu data untuk melanjutkan setup.'
          }
          action={
            search ? (
              <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                Reset filter
              </Button>
            ) : (
              <Link to={`/master-data/${kind}/new`}>{meta.createLabel}</Link>
            )
          }
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {meta.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((item) => (
                  <MasterRow key={item.id} kind={kind} item={item} columns={meta.columns} />
                ))}
              </tbody>
            </table>
          </div>
          <CursorPager
            nextCursor={query.data.pageInfo.nextCursor}
            hasNextPage={query.data.pageInfo.hasNextPage}
            itemCount={query.data.items.length}
          />
        </>
      )}
    </div>
  );
}

type MasterItem =
  | Awaited<ReturnType<typeof supplierApi.members>>['items'][number]
  | Awaited<ReturnType<typeof supplierApi.lines>>['items'][number]
  | Awaited<ReturnType<typeof supplierApi.parts>>['items'][number]
  | Awaited<ReturnType<typeof supplierApi.shiftTemplates>>['items'][number];

type MasterPage = {
  items: MasterItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
};

function MasterRow({
  kind,
  item,
  columns,
}: {
  kind: ResourceKind;
  item: MasterItem;
  columns: readonly string[];
}) {
  const values =
    kind === 'members' && 'fullName' in item
      ? [
          <span className="person-summary" key="member">
            <i>
              <PhotoWithFallback
                src={item.photo ? supplierAssetUrl(item.photo.thumbnailUrl) : null}
                alt=""
                fallback={item.initials}
              />
            </i>
            <strong>{item.fullName}</strong>
          </span>,
          item.registrationNumber ?? '—',
          label(item.role),
          item.account?.username ?? '—',
          item.account?.status ?? 'Tanpa akun',
          item.active ? 'Aktif' : 'Nonaktif',
        ]
      : kind === 'lines' && 'code' in item
        ? [item.code, item.name, item.displayOrder, item.active ? 'Aktif' : 'Nonaktif']
        : kind === 'parts' && 'partNumber' in item
          ? [item.partNumber, item.partName, item.active ? 'Aktif' : 'Nonaktif']
          : 'startTime' in item
            ? [
                item.name,
                `${item.startTime} - ${item.endTime}${item.crossesMidnight ? ' (+1)' : ''}`,
                item.timezone,
                item.active ? 'Aktif' : 'Nonaktif',
              ]
            : [];
  return (
    <tr>
      {values.map((value, index) => (
        <td key={index} data-label={columns[index]}>
          {value}
        </td>
      ))}
      <td data-label="Aksi">
        <Link to={`/master-data/${kind}/${item.id}`}>Buka</Link>
      </td>
    </tr>
  );
}

export function MasterFormPage({ kind }: { kind: ResourceKind }) {
  const { resourceId } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = Boolean(resourceId);
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(
    null,
  );
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(kind));
  const scope = scopeOf(session!);
  const detail = useQuery<MasterItem>({
    queryKey: scopedKey(scope, `master-${kind}-detail`, resourceId),
    queryFn: async () => {
      const result =
        kind === 'members'
          ? await supplierApi.member(resourceId!)
          : kind === 'lines'
            ? await supplierApi.line(resourceId!)
            : kind === 'parts'
              ? await supplierApi.part(resourceId!)
              : await supplierApi.shiftTemplate(resourceId!);
      return result;
    },
    enabled: editing,
  });

  useEffect(() => {
    if (detail.data) setValues(valuesFromResource(kind, detail.data));
  }, [detail.data, kind]);

  useEffect(() => {
    const dirty = Object.values(values).some(Boolean);
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [values]);

  const save = useMutation<MasterItem, Error>({
    mutationFn: async (): Promise<MasterItem> => {
      if (kind === 'members') {
        if (editing) {
          return supplierApi.updateMember(resourceId!, {
            expectedVersion: detail.data!.version,
            fullName: values.fullName,
            ...(values.role === 'MP' ? {} : { registrationNumber: values.registrationNumber }),
          });
        }
        const result = await supplierApi.createMember({
          fullName: values.fullName,
          ...(values.role === 'MP' ? {} : { registrationNumber: values.registrationNumber }),
          role: values.role,
          ...(values.role === 'MP' ? {} : { username: values.username }),
        });
        setSecret(result.credential ?? null);
        return result.member;
      }
      if (kind === 'lines') {
        const body = { code: values.code, name: values.name };
        return editing
          ? supplierApi.updateLine(resourceId!, {
              expectedVersion: detail.data!.version,
              ...body,
            })
          : supplierApi.createLine(body);
      }
      if (kind === 'parts') {
        const body = { partNumber: values.partNumber, partName: values.partName };
        return editing
          ? supplierApi.updatePart(resourceId!, {
              expectedVersion: detail.data!.version,
              ...body,
            })
          : supplierApi.createPart(body);
      }
      const body = {
        name: values.name,
        startTime: values.startTime,
        endTime: values.endTime,
        timezone: values.timezone,
      };
      return editing
        ? supplierApi.updateShiftTemplate(resourceId!, {
            expectedVersion: detail.data!.version,
            ...body,
          })
        : supplierApi.createShiftTemplate(body);
    },
    onSuccess: async (resource) => {
      if (editing) {
        queryClient.setQueryData(scopedKey(scope, `master-${kind}-detail`, resourceId), resource);
      }
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, `master-${kind}`).slice(0, -1),
      });
      toast.success(editing ? 'Perubahan disimpan' : `${resources[kind].title} ditambahkan`);
      if (editing) {
        void navigate(`/master-data/${kind}`, { replace: true });
        return;
      }
      if (!editing && (kind !== 'members' || ('role' in resource && resource.role === 'MP')))
        void navigate(`/master-data/${kind}/${resource.id}`, { replace: true });
    },
    onError: (error) =>
      setProblem(
        error instanceof ApiProblemError
          ? error.problem.detail
          : 'Perubahan tidak dapat disimpan. Muat ulang sebelum mencoba kembali.',
      ),
  });

  if (detail.isLoading) return <TableSkeleton />;
  if (detail.isError)
    return (
      <ErrorState
        title="Detail tidak dapat dimuat"
        description=""
        action={<Button onClick={() => void detail.refetch()}>Coba lagi</Button>}
      />
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    save.mutate();
  };

  return (
    <div className="product-page">
      <MasterBackLink to={`/master-data/${kind}`} label={resources[kind].title} />
      <PageHeader
        eyebrow={resources[kind].title}
        title={editing ? 'Edit data' : resources[kind].createLabel}
        description=""
      />
      {problem && (
        <Alert tone="danger" title="Perubahan gagal">
          {problem}
        </Alert>
      )}
      {secret ? (
        <OneTimeCredential
          value={secret}
          onDone={() => {
            setSecret(null);
            void navigate(`/master-data/members`, { replace: true });
          }}
        />
      ) : (
        <Card className="resource-form-card">
          <form onSubmit={submit}>
            <MasterFields kind={kind} values={values} setValues={setValues} editing={editing} />
            <div className="form-actions">
              <Button type="submit" loading={save.isPending}>
                {editing ? 'Simpan perubahan' : 'Buat data'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void navigate(`/master-data/${kind}`)}
              >
                Batal
              </Button>
            </div>
          </form>
        </Card>
      )}
      {editing && kind === 'members' && detail.data && 'role' in detail.data && (
        <MemberLifecycle member={detail.data} scope={scope} />
      )}
      {editing && kind !== 'members' && detail.data && (
        <ResourceLifecycle kind={kind} resource={detail.data} scope={scope} />
      )}
      {editing && kind === 'lines' && detail.data && 'code' in detail.data && (
        <JobsPanel lineId={detail.data.id} scope={scope} />
      )}
    </div>
  );
}

function ResourceLifecycle({
  kind,
  resource,
  scope,
}: {
  kind: Exclude<ResourceKind, 'members'>;
  resource: MasterItem;
  scope: ReturnType<typeof scopeOf>;
}) {
  const queryClient = useQueryClient();
  const active = resource.active;
  const [problem, setProblem] = useState<string | null>(null);
  const action = useMutation<unknown, Error>({
    mutationFn: () => {
      const next = active ? 'deactivate' : 'activate';
      const body = { expectedVersion: resource.version };
      if (kind === 'lines') return supplierApi.lineAction(resource.id, next, body);
      if (kind === 'parts') return supplierApi.partAction(resource.id, next, body);
      return supplierApi.shiftTemplateAction(resource.id, next, body);
    },
    onSuccess: () =>
      queryClient
        .invalidateQueries({
          queryKey: scopedKey(scope, `master-${kind}-detail`, resource.id),
        })
        .then(() => toast.success(active ? 'Data dinonaktifkan' : 'Data diaktifkan')),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <Panel title="Status" description="">
      {problem && (
        <Alert tone="danger" title="Perubahan gagal">
          {problem}
        </Alert>
      )}
      <Button
        variant="secondary"
        loading={action.isPending}
        onClick={() => {
          setProblem(null);
          if (window.confirm(`${active ? 'Nonaktifkan' : 'Aktifkan'} resource ini?`))
            action.mutate();
        }}
      >
        {active ? 'Nonaktifkan' : 'Aktifkan'}
      </Button>
    </Panel>
  );
}

function MasterFields({
  kind,
  values,
  setValues,
  editing,
}: {
  kind: ResourceKind;
  values: Record<string, string>;
  setValues: (value: Record<string, string>) => void;
  editing: boolean;
}) {
  const field = (key: string, value: string) => setValues({ ...values, [key]: value });
  if (kind === 'members')
    return (
      <>
        <Field label="Nama lengkap" htmlFor="fullName" required>
          <Input
            id="fullName"
            value={values.fullName}
            onChange={(event) => field('fullName', event.target.value)}
            required
          />
        </Field>
        {values.role !== 'MP' && (
          <Field label="Nomor registrasi" htmlFor="registrationNumber" required>
            <Input
              id="registrationNumber"
              value={values.registrationNumber}
              onChange={(event) => field('registrationNumber', event.target.value)}
              required
            />
          </Field>
        )}
        <Field label="Role" htmlFor="role" required>
          <NativeSelect
            id="role"
            disabled={editing}
            value={values.role}
            onChange={(event) => field('role', event.target.value)}
          >
            <option value="MP">MP</option>
            <option value="LINE_LEADER">Line Leader</option>
            <option value="SUPERVISOR">Supervisor</option>
            <option value="QC">QC</option>
          </NativeSelect>
        </Field>
        {!editing && values.role !== 'MP' && (
          <Field label="Username" htmlFor="username" required>
            <Input
              id="username"
              value={values.username}
              onChange={(event) => field('username', event.target.value)}
              required
            />
          </Field>
        )}
      </>
    );
  if (kind === 'parts')
    return (
      <>
        <Field label="Part number" htmlFor="partNumber" required>
          <Input
            id="partNumber"
            value={values.partNumber}
            onChange={(event) => field('partNumber', event.target.value)}
            required
          />
        </Field>
        <Field label="Nama part" htmlFor="partName" required>
          <Input
            id="partName"
            value={values.partName}
            onChange={(event) => field('partName', event.target.value)}
            required
          />
        </Field>
      </>
    );
  if (kind === 'shifts')
    return (
      <>
        <Field label="Nama template" htmlFor="name" required>
          <Input
            id="name"
            value={values.name}
            onChange={(event) => field('name', event.target.value)}
            required
          />
        </Field>
        <div className="form-grid">
          <Field label="Mulai" htmlFor="startTime" required>
            <Input
              id="startTime"
              type="time"
              value={values.startTime}
              onChange={(event) => field('startTime', event.target.value)}
              required
            />
          </Field>
          <Field label="Selesai" htmlFor="endTime" required>
            <Input
              id="endTime"
              type="time"
              value={values.endTime}
              onChange={(event) => field('endTime', event.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="IANA timezone" htmlFor="timezone" required>
          <Input
            id="timezone"
            value={values.timezone}
            onChange={(event) => field('timezone', event.target.value)}
            required
          />
        </Field>
      </>
    );
  return (
    <>
      <Field label="Kode line" htmlFor="code" required>
        <Input
          id="code"
          value={values.code}
          onChange={(event) => field('code', event.target.value)}
          required
        />
      </Field>
      <Field label="Nama line" htmlFor="name" required>
        <Input
          id="name"
          value={values.name}
          onChange={(event) => field('name', event.target.value)}
          required
        />
      </Field>
    </>
  );
}

export function MemberLifecycle({
  member,
  scope,
}: {
  member: Awaited<ReturnType<typeof supplierApi.member>>;
  scope: ReturnType<typeof scopeOf>;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const invalidatePhotoViews = async () => {
    await Promise.all([
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
  };
  const action = useMutation({
    mutationFn: async (kind: 'status' | 'reset') => {
      if (kind === 'reset') {
        const result = await supplierApi.resetMemberPassword(member.id, {
          expectedVersion: member.account!.version,
        });
        setSecret(result.credential ?? null);
        return;
      }
      await supplierApi.memberAction(member.id, member.active ? 'deactivate' : 'activate', {
        expectedVersion: member.version,
      });
    },
    onSuccess: async (_, kind) => {
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members-detail', member.id),
      });
      if (kind === 'status') {
        await queryClient.invalidateQueries({
          queryKey: scopedKey(scope, 'master-members').slice(0, -1),
        });
        toast.success(member.active ? 'Member dipindahkan ke arsip' : 'Member diaktifkan');
        if (member.active) void navigate('/master-data/members', { replace: true });
      } else toast.success('Password berhasil direset');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const photo = useMutation({
    mutationFn: (file: File) => supplierApi.uploadMemberPhoto(member.id, file),
    onSuccess: async (updatedMember) => {
      queryClient.setQueryData(scopedKey(scope, 'master-members-detail', member.id), updatedMember);
      setPhotoNotice(member.photo ? 'Foto berhasil diganti.' : 'Foto berhasil diset.');
      await invalidatePhotoViews();
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const removePhoto = useMutation({
    mutationFn: () => supplierApi.removeMemberPhoto(member.id, member.photo!.version),
    onSuccess: async () => {
      setPhotoNotice('Foto berhasil dihapus. Initials kembali digunakan sebagai avatar.');
      await invalidatePhotoViews();
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const photoPending = photo.isPending || removePhoto.isPending;
  return (
    <Panel title="Member & foto" description="">
      {secret && <OneTimeCredential value={secret} onDone={() => setSecret(null)} />}
      {problem && (
        <Alert tone="danger" title="Perubahan member gagal">
          {problem}
        </Alert>
      )}
      {photoNotice && (
        <Alert tone="success" title="Foto member diperbarui">
          {photoNotice}
        </Alert>
      )}
      <div className="member-photo-editor">
        <div className="member-photo-editor__preview">
          <PhotoWithFallback
            src={member.photo ? supplierAssetUrl(member.photo.thumbnailUrl) : null}
            alt={`Foto ${member.fullName}`}
            fallback={member.initials}
            fallbackLabel={`Initials ${member.fullName}`}
          />
        </div>
        <div className="member-photo-editor__content">
          <strong>{member.photo ? 'Foto member aktif' : 'Foto belum diset'}</strong>
          <p>Gunakan JPG, PNG, atau WebP dengan ukuran maksimum 2 MB.</p>
          <div className="member-photo-editor__actions">
            <label className={`photo-upload${photoPending ? ' is-disabled' : ''}`}>
              <Camera aria-hidden="true" />
              {photo.isPending ? 'Mengunggah…' : member.photo ? 'Ganti foto' : 'Set foto'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={photoPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  setProblem(null);
                  setPhotoNotice(null);
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setProblem('Format foto harus JPG, PNG, atau WebP.');
                    return;
                  }
                  if (file.size > 2 * 1024 * 1024) {
                    setProblem('Ukuran foto maksimal 2 MB.');
                    return;
                  }
                  photo.mutate(file);
                }}
              />
            </label>
            {member.photo && (
              <Button
                variant="danger"
                leadingIcon={<Trash2 />}
                loading={removePhoto.isPending}
                disabled={photoPending}
                onClick={() => {
                  setProblem(null);
                  setPhotoNotice(null);
                  if (
                    window.confirm('Hapus foto member ini dan gunakan initials sebagai avatar?')
                  ) {
                    removePhoto.mutate();
                  }
                }}
              >
                Hapus foto
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="lifecycle-actions">
        {member.account && (
          <p className="member-account-identity">
            <span>Username</span>
            <strong>{member.account.username}</strong>
          </p>
        )}
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
            action.mutate('status');
          }}
          trigger={
            <Button variant={member.active ? 'danger' : 'secondary'} loading={action.isPending}>
              {member.active ? 'Hapus member' : 'Pulihkan member'}
            </Button>
          }
        />
        {member.account && (
          <AlertDialog
            title="Reset password member?"
            description="Password sementara yang baru akan ditampilkan satu kali."
            confirmLabel="Reset password"
            onConfirm={() => {
              setProblem(null);
              action.mutate('reset');
            }}
            trigger={<Button variant="secondary">Reset password</Button>}
          />
        )}
      </div>
    </Panel>
  );
}

function PhotoWithFallback({
  src,
  alt,
  fallback,
  fallbackLabel,
}: {
  src: string | null;
  alt: string;
  fallback: ReactNode;
  fallbackLabel?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && failedSrc !== src ? (
    <img src={src} alt={alt} onError={() => setFailedSrc(src)} />
  ) : (
    <span {...(fallbackLabel ? { 'aria-label': fallbackLabel } : {})}>{fallback}</span>
  );
}

function JobsPanel({ lineId, scope }: { lineId: string; scope: ReturnType<typeof scopeOf> }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [skillCategory, setSkillCategory] = useState('MEDIUM');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingJobName, setEditingJobName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: scopedKey(scope, 'line-jobs', lineId),
    queryFn: () => supplierApi.jobs(lineId, { limit: 100, active: 'ALL' }),
  });
  const refreshJobViews = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'line-jobs', lineId) }),
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'tanoko') }),
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'assignment-board').slice(0, -1),
      }),
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'line-shifts', lineId) }),
    ]);
  const create = useMutation({
    mutationFn: () => supplierApi.createJob(lineId, { name, skillCategory }),
    onSuccess: async () => {
      setName('');
      await refreshJobViews();
      toast.success('Job ditambahkan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const categoryChange = useMutation({
    mutationFn: ({
      id,
      name,
      version,
      skillCategory,
    }: {
      id: string;
      name: string;
      version: number;
      skillCategory: string;
    }) => supplierApi.updateJob(lineId, id, { name, expectedVersion: version, skillCategory }),
    onSuccess: async () => {
      await refreshJobViews();
      toast.success('Kategori job disimpan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const rename = useMutation({
    mutationFn: ({
      id,
      version,
      skillCategory,
    }: {
      id: string;
      version: number;
      skillCategory: string | null;
    }) =>
      supplierApi.updateJob(lineId, id, {
        name: editingJobName.trim(),
        expectedVersion: version,
        ...(skillCategory ? { skillCategory } : {}),
      }),
    onSuccess: async () => {
      await refreshJobViews();
      setEditingJobId(null);
      setEditingJobName('');
      toast.success('Nama job disimpan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const change = useMutation({
    mutationFn: async ({
      jobId,
      kind,
      index,
    }: {
      jobId: string;
      kind: 'toggle' | 'up' | 'down';
      index: number;
    }) => {
      const current = jobs.data!.items[index]!;
      if (kind === 'toggle') {
        await supplierApi.jobAction(lineId, jobId, current.active ? 'deactivate' : 'activate', {
          expectedVersion: current.version,
        });
        return;
      }
      const reordered = [...jobs.data!.items];
      const target = kind === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= reordered.length) return;
      [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
      await supplierApi.reorderJobs(lineId, {
        items: reordered.map((job) => ({ id: job.id, expectedVersion: job.version })),
      });
    },
    onSuccess: async () => {
      await refreshJobViews();
      toast.success('Job diperbarui');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <Panel title="Job berurutan" description="">
      {problem && (
        <Alert tone="danger" title="Perubahan job gagal">
          {problem}
        </Alert>
      )}
      <form
        className="inline-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) {
            setProblem(null);
            create.mutate();
          }
        }}
      >
        <Input
          value={name}
          placeholder="Nama job baru"
          onChange={(event) => setName(event.target.value)}
        />
        <NativeSelect
          aria-label="Kategori skill job baru"
          value={skillCategory}
          onChange={(e) => setSkillCategory(e.target.value)}
        >
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </NativeSelect>
        <Button type="submit" loading={create.isPending}>
          Tambah job
        </Button>
      </form>
      <ol className="job-list">
        {jobs.data?.items.map((job, index) => (
          <li key={job.id}>
            <span>{job.displayOrder}</span>
            {editingJobId === job.id ? (
              <form
                className="job-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (editingJobName.trim() && editingJobName.trim() !== job.name) {
                    setProblem(null);
                    rename.mutate({
                      id: job.id,
                      version: job.version,
                      skillCategory: job.skillCategory ?? null,
                    });
                  }
                }}
              >
                <Input
                  aria-label={`Nama job ${job.name}`}
                  autoFocus
                  required
                  maxLength={150}
                  value={editingJobName}
                  disabled={rename.isPending}
                  onChange={(event) => setEditingJobName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !rename.isPending) {
                      setEditingJobId(null);
                      setEditingJobName('');
                    }
                  }}
                />
                <Button
                  size="sm"
                  type="submit"
                  loading={rename.isPending}
                  disabled={!editingJobName.trim() || editingJobName.trim() === job.name}
                >
                  Simpan
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={rename.isPending}
                  onClick={() => {
                    setEditingJobId(null);
                    setEditingJobName('');
                  }}
                >
                  Batal
                </Button>
              </form>
            ) : (
              <strong className="job-list__name">{job.name}</strong>
            )}
            <NativeSelect
              aria-label={`Kategori skill ${job.name}`}
              value={job.skillCategory ?? ''}
              disabled={categoryChange.isPending || editingJobId !== null}
              onChange={(e) =>
                categoryChange.mutate({
                  id: job.id,
                  name: job.name,
                  version: job.version,
                  skillCategory: e.target.value,
                })
              }
            >
              <option value="" disabled>
                Belum diatur
              </option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </NativeSelect>
            <small>{job.active ? 'Aktif' : 'Nonaktif'}</small>
            <div>
              {editingJobId !== job.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Ubah nama job ${job.name}`}
                  disabled={rename.isPending || editingJobId !== null}
                  onClick={() => {
                    setProblem(null);
                    setEditingJobId(job.id);
                    setEditingJobName(job.name);
                  }}
                >
                  Ubah nama
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={index === 0 || change.isPending || editingJobId !== null}
                onClick={() => {
                  setProblem(null);
                  change.mutate({ jobId: job.id, kind: 'up', index });
                }}
              >
                Naik
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  index === (jobs.data?.items.length ?? 0) - 1 ||
                  change.isPending ||
                  editingJobId !== null
                }
                onClick={() => {
                  setProblem(null);
                  change.mutate({ jobId: job.id, kind: 'down', index });
                }}
              >
                Turun
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={change.isPending || editingJobId !== null}
                onClick={() => {
                  setProblem(null);
                  if (window.confirm(`${job.active ? 'Nonaktifkan' : 'Aktifkan'} job ini?`))
                    change.mutate({ jobId: job.id, kind: 'toggle', index });
                }}
              >
                {job.active ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function OneTimeCredential({
  value,
  onDone,
}: {
  value: { username: string; temporaryPassword: string };
  onDone: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="one-time-secret">
      <UserRound aria-hidden="true" />
      <div>
        <span className="product-eyebrow">Ditampilkan satu kali</span>
        <h2>Simpan informasi akun</h2>
        <dl>
          <div>
            <dt>Username</dt>
            <dd>{value.username}</dd>
          </div>
          <div>
            <dt>Temporary password</dt>
            <dd>
              <code>{value.temporaryPassword}</code>
            </dd>
          </div>
        </dl>
        <Button
          variant="secondary"
          leadingIcon={<Clipboard />}
          onClick={() => void navigator.clipboard.writeText(value.temporaryPassword)}
        >
          Salin password
        </Button>
        <label className="acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          Saya sudah menyimpan informasi akun.
        </label>
        <Button disabled={!acknowledged} leadingIcon={<Check />} onClick={onDone}>
          Selesai
        </Button>
      </div>
    </div>
  );
}

export function ChecklistOverviewPage() {
  return (
    <div className="product-page">
      <MasterBackLink to="/master-data" label="Master Data" />
      <PageHeader eyebrow="Master Data" title="Checklist 4M" description="" />
      <section className="checklist-category-grid">
        {(['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const).map((category) => (
          <Link key={category} to={`/master-data/checklists/${category}`}>
            <span>{category}</span>
            <strong>{label(category)}</strong>
            <ArrowRight />
          </Link>
        ))}
      </section>
    </div>
  );
}

export function ChecklistDetailPage() {
  const { category = 'MAN' } = useParams();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const scope = scopeOf(session!);
  const draft = useQuery({
    queryKey: scopedKey(scope, 'checklist-draft', category),
    queryFn: () => supplierApi.checklistDraft(category),
  });
  const versions = useQuery({
    queryKey: scopedKey(scope, 'checklist-versions', category),
    queryFn: () => supplierApi.checklistVersions(category),
  });
  const [items, setItems] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = draft.data
    ? JSON.stringify(items) !== JSON.stringify(draft.data.items.map((item) => item.label))
    : false;
  const invalid = items.some((item) => !item.trim());
  useEffect(() => {
    if (draft.data) setItems(draft.data.items.map((item) => item.label));
  }, [draft.data]);
  const save = useMutation({
    mutationFn: () =>
      supplierApi.updateChecklistDraft(category, {
        expectedVersion: draft.data?.version,
        items: items.filter(Boolean).map((item) => ({ label: item })),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'checklist-draft', category),
      });
      setNotice('Draft disimpan.');
      toast.success('Draft disimpan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const publish = useMutation({
    mutationFn: () =>
      supplierApi.publishChecklist(category, { expectedVersion: draft.data!.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'checklist-draft', category),
      });
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'checklist-versions', category),
      });
      setNotice('Checklist dipublikasikan.');
      toast.success('Checklist dipublikasikan');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const lifecycle = useMutation({
    mutationFn: () =>
      supplierApi.checklistAction(category, draft.data!.active ? 'deactivate' : 'activate', {
        expectedVersion: draft.data!.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'checklist-draft', category),
      });
      toast.success('Status checklist diperbarui');
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <div className="product-page">
      <MasterBackLink to="/master-data/checklists" label="Checklist 4M" />
      <PageHeader eyebrow="Checklist 4M" title={label(category)} description="" />
      {notice && (
        <div role="status" className="sr-only">
          {notice}
        </div>
      )}
      {problem && (
        <Alert tone="danger" title="Perubahan checklist gagal">
          {problem}
        </Alert>
      )}
      {draft.isLoading && <TableSkeleton />}
      {draft.data && (
        <div className="checklist-editor">
          <Panel
            title="Draft saat ini"
            description={`${items.length} item · Versi draft ${draft.data.version}`}
            className="checklist-editor__draft"
          >
            <div className="checklist-editor__state">
              <span className={draft.data.active ? 'is-active' : 'is-inactive'}>
                {draft.data.active ? 'Aktif' : 'Nonaktif'}
              </span>
              {dirty && <span className="checklist-editor__dirty">Belum disimpan</span>}
            </div>
            <ol>
              {items.map((item, index) => (
                <li key={index}>
                  <span>{index + 1}</span>
                  <Input
                    aria-label={`Item checklist ${index + 1}`}
                    placeholder={`Item ${index + 1}`}
                    value={item}
                    onChange={(event) =>
                      setItems(
                        items.map((current, itemIndex) =>
                          itemIndex === index ? event.target.value : current,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Hapus item ${index + 1}`}
                    onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setItems([...items, ''])}>
                Tambah item
              </Button>
              <Button
                loading={save.isPending}
                disabled={!dirty || invalid || save.isPending}
                onClick={() => {
                  setProblem(null);
                  save.mutate();
                }}
              >
                Simpan draft
              </Button>
            </div>
            {dirty && <p className="checklist-editor__hint">Simpan draft sebelum publish.</p>}
          </Panel>
          <Panel title="Publikasi" description="" className="checklist-editor__side">
            <Button
              disabled={dirty || invalid || !items.length || publish.isPending}
              loading={publish.isPending}
              onClick={() => {
                setProblem(null);
                if (window.confirm('Publish draft ini sebagai versi baru?')) publish.mutate();
              }}
            >
              Publish versi baru
            </Button>
            <Button
              variant="secondary"
              loading={lifecycle.isPending}
              onClick={() => {
                setProblem(null);
                if (
                  window.confirm(
                    `${draft.data.active ? 'Nonaktifkan' : 'Aktifkan'} checklist ${label(category)}?`,
                  )
                )
                  lifecycle.mutate();
              }}
            >
              {draft.data.active ? 'Nonaktifkan checklist' : 'Aktifkan checklist'}
            </Button>
            <div className="checklist-editor__history">
              <h3>Riwayat versi</h3>
              <ol className="version-list">
                {versions.data?.items.map((version) => (
                  <li key={version.id}>
                    <strong>Versi {version.versionNumber}</strong>
                    <span>{version.items.length} item</span>
                    <small>{new Date(version.publishedAt).toLocaleString('id-ID')}</small>
                  </li>
                ))}
              </ol>
              {!versions.data?.items.length && <p>Belum ada versi terbit.</p>}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="list-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

function initialValues(kind: ResourceKind) {
  if (kind === 'members') return { fullName: '', registrationNumber: '', role: 'MP', username: '' };
  if (kind === 'parts') return { partNumber: '', partName: '' };
  if (kind === 'shifts')
    return { name: '', startTime: '08:00', endTime: '17:00', timezone: 'Asia/Jakarta' };
  return { code: '', name: '' };
}

function valuesFromResource(kind: ResourceKind, resource: MasterItem) {
  if (kind === 'members' && 'fullName' in resource)
    return {
      fullName: resource.fullName,
      registrationNumber: resource.registrationNumber ?? '',
      role: resource.role,
      username: resource.account?.username ?? '',
    };
  if (kind === 'parts' && 'partNumber' in resource)
    return { partNumber: resource.partNumber, partName: resource.partName };
  if (kind === 'shifts' && 'startTime' in resource)
    return {
      name: resource.name,
      startTime: resource.startTime,
      endTime: resource.endTime,
      timezone: resource.timezone,
    };
  if ('code' in resource) return { code: resource.code, name: resource.name };
  return initialValues(kind);
}

function scopeOf(session: NonNullable<ReturnType<typeof useSession>['session']>) {
  return {
    userId: session.principal.userId,
    supplierId: session.supplier!.id,
    purpose: session.principal.purpose,
  };
}

function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}

export function masterMutationProblem(error: unknown): string {
  return error instanceof ApiProblemError
    ? error.problem.detail
    : 'Perubahan tidak dapat disimpan. Muat ulang sebelum mencoba kembali.';
}
