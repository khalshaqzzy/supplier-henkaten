import { ArrowRight, Camera, Check, Clipboard, Database, Plus, UserRound } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  Alert,
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
} from '@tmmin-henkaten/ui';

import { ApiProblemError } from '@tmmin-henkaten/api-client';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { CursorPager } from '../components/CursorPager';
import { PageHeader } from '../components/layout';

const resources = {
  members: {
    title: 'Member & Akun',
    description: 'Kelola identitas operator, role, akun, dan foto secara individual.',
    createLabel: 'Tambah member',
    columns: ['Member', 'Registrasi', 'Role', 'Akun', 'Status'],
  },
  lines: {
    title: 'Line & Job',
    description: 'Kelola line dan urutan job yang menjadi struktur assignment.',
    createLabel: 'Tambah line',
    columns: ['Line', 'Nama', 'Urutan', 'Status'],
  },
  parts: {
    title: 'Part',
    description: 'Kelola part number dan nama yang dapat dicari saat membuat Henkaten.',
    createLabel: 'Tambah part',
    columns: ['Part number', 'Nama part', 'Status'],
  },
  shifts: {
    title: 'Shift Template',
    description: 'Kelola jam kerja lokal, timezone, dan shift yang melintasi tengah malam.',
    createLabel: 'Tambah template',
    columns: ['Template', 'Jam', 'Timezone', 'Status'],
  },
} as const;

type ResourceKind = keyof typeof resources;

export function MasterDataOverviewPage() {
  const cards = [
    ['Member & Akun', 'Identitas, credential, dan foto', '/master-data/members'],
    ['Line & Job', 'Struktur line dan job berurutan', '/master-data/lines'],
    ['Part', 'Part number dan nama', '/master-data/parts'],
    ['Shift Template', 'Jam, timezone, dan lintas tengah malam', '/master-data/shifts'],
    ['Checklist 4M', 'Draft, publish, dan riwayat versi', '/master-data/checklists'],
    ['Default Assignment', 'Supervisor, LL, dan MP default', '/master-data/default-assignments'],
  ] as const;
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Konfigurasi Supplier"
        title="Master Data"
        description="Data referensi individual yang menjadi prerequisite workflow Hosted."
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
              <small>{description}</small>
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
      <PageHeader
        eyebrow="Master Data"
        title={meta.title}
        description={meta.description}
        actions={
          <Link
            className="hds-button hds-button--primary hds-button--md"
            to={`/master-data/${kind}/new`}
          >
            <Plus aria-hidden="true" />
            {meta.createLabel}
          </Link>
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
            <option value="INACTIVE">Nonaktif</option>
            <option value="ALL">Semua</option>
          </NativeSelect>
        </label>
      </FilterBar>
      {query.isLoading && <TableSkeleton />}
      {query.isError && (
        <ErrorState
          title={`${meta.title} tidak dapat dimuat`}
          description="Coba kembali. Data stale tidak disamarkan sebagai hasil kosong."
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
            <i>{item.initials}</i>
            <strong>{item.fullName}</strong>
          </span>,
          item.registrationNumber,
          label(item.role),
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
            registrationNumber: values.registrationNumber,
          });
        }
        const result = await supplierApi.createMember({
          fullName: values.fullName,
          registrationNumber: values.registrationNumber,
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
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, `master-${kind}`) });
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
        description="Resource mungkin sudah tidak tersedia atau berada di luar scope."
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
      <PageHeader
        eyebrow={resources[kind].title}
        title={editing ? 'Edit data' : resources[kind].createLabel}
        description="Perubahan divalidasi kembali oleh server dan memakai version resource terbaru."
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
              <Button type="button" variant="ghost" onClick={() => void navigate(-1)}>
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
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, `master-${kind}-detail`, resource.id),
      }),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <Panel
      title="Lifecycle"
      description="Referenced-data blocker diperiksa secara authoritative oleh server."
    >
      {problem && (
        <Alert tone="danger" title="Perubahan lifecycle gagal">
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
        <Field label="Nomor registrasi" htmlFor="registrationNumber" required>
          <Input
            id="registrationNumber"
            value={values.registrationNumber}
            onChange={(event) => field('registrationNumber', event.target.value)}
            required
          />
        </Field>
        <Field
          label="Role"
          htmlFor="role"
          helperText={editing ? 'Role immutable setelah dibuat.' : undefined}
          required
        >
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

function MemberLifecycle({
  member,
  scope,
}: {
  member: Awaited<ReturnType<typeof supplierApi.member>>;
  scope: ReturnType<typeof scopeOf>;
}) {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ username: string; temporaryPassword: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
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
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members-detail', member.id),
      }),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const photo = useMutation({
    mutationFn: (file: File) => supplierApi.uploadMemberPhoto(member.id, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: scopedKey(scope, 'master-members-detail', member.id),
      }),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <Panel
      title="Lifecycle & foto"
      description="Action berdampak tinggi memerlukan konfirmasi eksplisit."
    >
      {secret && <OneTimeCredential value={secret} onDone={() => setSecret(null)} />}
      {problem && (
        <Alert tone="danger" title="Perubahan member gagal">
          {problem}
        </Alert>
      )}
      <div className="lifecycle-actions">
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null);
            if (window.confirm(`${member.active ? 'Nonaktifkan' : 'Aktifkan'} member ini?`))
              action.mutate('status');
          }}
        >
          {member.active ? 'Nonaktifkan member' : 'Aktifkan member'}
        </Button>
        {member.account && (
          <Button
            variant="secondary"
            onClick={() => {
              setProblem(null);
              if (window.confirm('Reset password dan tampilkan temporary password baru?'))
                action.mutate('reset');
            }}
          >
            Reset password
          </Button>
        )}
        <label className="photo-upload">
          <Camera aria-hidden="true" />
          Ganti photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setProblem(null);
              if (file.size > 2 * 1024 * 1024) {
                setProblem('Ukuran foto maksimal 2 MB.');
                return;
              }
              photo.mutate(file);
            }}
          />
        </label>
      </div>
    </Panel>
  );
}

function JobsPanel({ lineId, scope }: { lineId: string; scope: ReturnType<typeof scopeOf> }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: scopedKey(scope, 'line-jobs', lineId),
    queryFn: () => supplierApi.jobs(lineId, { limit: 100, active: 'ALL' }),
  });
  const create = useMutation({
    mutationFn: () => supplierApi.createJob(lineId, { name }),
    onSuccess: async () => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'line-jobs', lineId) });
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'line-jobs', lineId) }),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <Panel
      title="Job berurutan"
      description="Job dipertahankan sebagai resource terpisah untuk assignment dan history."
    >
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
        <Button type="submit" loading={create.isPending}>
          Tambah job
        </Button>
      </form>
      <ol className="job-list">
        {jobs.data?.items.map((job, index) => (
          <li key={job.id}>
            <span>{job.displayOrder}</span>
            <strong>{job.name}</strong>
            <small>{job.active ? 'Aktif' : 'Nonaktif'}</small>
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={index === 0 || change.isPending}
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
                disabled={index === (jobs.data?.items.length ?? 0) - 1 || change.isPending}
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
                disabled={change.isPending}
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
        <h2>Simpan temporary credential dengan aman</h2>
        <p>Credential tidak dapat ditampilkan kembali setelah panel ini ditutup.</p>
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
          Saya sudah menyimpan dan akan menyalurkan credential melalui proses aman.
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
      <PageHeader
        eyebrow="Master Data"
        title="Checklist 4M"
        description="Setiap kategori memiliki draft dan versi published yang immutable."
      />
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
  useEffect(() => {
    if (draft.data) setItems(draft.data.items.map((item) => item.label));
  }, [draft.data]);
  const save = useMutation({
    mutationFn: () =>
      supplierApi.updateChecklistDraft(category, {
        expectedVersion: draft.data?.version,
        items: items.filter(Boolean).map((item) => ({ label: item })),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'checklist-draft', category) }),
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
    },
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  const lifecycle = useMutation({
    mutationFn: () =>
      supplierApi.checklistAction(category, draft.data!.active ? 'deactivate' : 'activate', {
        expectedVersion: draft.data!.version,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'checklist-draft', category) }),
    onError: (error) => setProblem(masterMutationProblem(error)),
  });
  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Checklist 4M"
        title={label(category)}
        description="Edit draft, lalu publish sebagai snapshot version baru."
      />
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
            description={`Version ${draft.data.version} · ${draft.data.active ? 'aktif' : 'nonaktif'}`}
          >
            <ol>
              {items.map((item, index) => (
                <li key={index}>
                  <span>{index + 1}</span>
                  <Input
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
                    onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    Hapus
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
                onClick={() => {
                  setProblem(null);
                  save.mutate();
                }}
              >
                Simpan draft
              </Button>
              <Button
                variant="danger"
                disabled={!items.some(Boolean)}
                loading={publish.isPending}
                onClick={() => {
                  setProblem(null);
                  if (window.confirm('Publish draft ini sebagai versi immutable baru?'))
                    publish.mutate();
                }}
              >
                Publish
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
                {draft.data.active ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
            </div>
          </Panel>
          <Panel title="Riwayat versi" description="Versi published tidak dapat diedit.">
            <ol className="version-list">
              {versions.data?.items.map((version) => (
                <li key={version.id}>
                  <strong>Version {version.versionNumber}</strong>
                  <span>{version.items.length} item</span>
                  <small>{new Date(version.publishedAt).toLocaleString('id-ID')}</small>
                </li>
              ))}
            </ol>
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
      registrationNumber: resource.registrationNumber,
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
