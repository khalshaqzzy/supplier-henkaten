import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Plus, RefreshCw, UserRoundPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  KeyValueGrid,
  NativeSelect,
  OneTimeCredentialPanel,
  Panel,
  StatusBadge,
  Textarea,
  Timeline,
} from '@tmmin-henkaten/ui';

import { tmminApi } from '../app/api';
import { tmminKey } from '../app/query';
import { useTmminSession } from '../app/session';
import { PageHeader } from '../components/layout';
import { QueryState } from './StatePages';

export function SuppliersPage() {
  const { session } = useTmminSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const admin = session!.principal.role === 'TMMIN_ADMIN';
  const query = {
    limit: 25,
    status: (params.get('status') ?? 'ALL') as 'ALL' | 'ACTIVE' | 'INACTIVE',
    sort: (params.get('sort') ?? 'NAME_ASC') as 'NAME_ASC' | 'UPDATED_DESC',
    ...(params.get('search') ? { search: params.get('search')! } : {}),
    ...(params.get('sourceMode')
      ? { sourceMode: params.get('sourceMode') as 'HOSTED' | 'EXTERNAL' }
      : {}),
  };
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'suppliers', query),
    queryFn: () => tmminApi.suppliers(query),
  });
  return (
    <>
      <PageHeader
        eyebrow="Registry supplier"
        title="Supplier"
        description="Lifecycle, source mode, timezone, dan konteks administrasi terkini."
        actions={
          admin ? (
            <Button
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => void navigate('/suppliers/new')}
            >
              Buat supplier
            </Button>
          ) : undefined
        }
      />
      <div className="tmmin-filter-strip">
        <Input
          aria-label="Cari supplier"
          placeholder="Cari kode atau nama"
          defaultValue={params.get('search') ?? ''}
          onBlur={(event) => setSearch(params, setParams, 'search', event.target.value)}
        />
        <NativeSelect
          aria-label="Supplier status"
          value={query.status}
          onChange={(event) => setSearch(params, setParams, 'status', event.target.value)}
        >
          <option value="ALL">Semua status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="INACTIVE">Nonaktif</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Server sort"
          value={query.sort}
          onChange={(event) => setSearch(params, setParams, 'sort', event.target.value)}
        >
          <option value="NAME_ASC">Nama A–Z</option>
          <option value="UPDATED_DESC">Terakhir diperbarui</option>
        </NativeSelect>
      </div>
      {result.isLoading ? (
        <LoadingRows />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : result.data.items.length === 0 ? (
        <QueryState />
      ) : (
        <Panel
          title={`${result.data.items.length} suppliers`}
          description="Filter server-side dengan urutan cursor yang stabil"
        >
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Sumber</th>
                  <th>Timezone</th>
                  <th>Status</th>
                  <th>Diperbarui</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.code}</strong>
                      <small>{row.name}</small>
                    </td>
                    <td>
                      <StatusBadge tone={row.sourceMode === 'HOSTED' ? 'info' : 'neutral'}>
                        {row.sourceMode} · E{row.sourceEpoch}
                      </StatusBadge>
                    </td>
                    <td>{row.timezone}</td>
                    <td>
                      <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                        {row.active ? 'ACTIVE' : 'INACTIVE'}
                      </StatusBadge>
                    </td>
                    <td>{dateTime(row.updatedAt)}</td>
                    <td>
                      <Link to={`/suppliers/${row.id}`}>Lihat</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

const supplierFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    name: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
    sourceMode: z.enum(['HOSTED', 'EXTERNAL']),
    adminUsername: z.string().trim().max(100).optional(),
    adminName: z.string().trim().max(150).optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceMode === 'HOSTED' && (!value.adminUsername || !value.adminName)) {
      context.addIssue({
        code: 'custom',
        path: ['adminUsername'],
        message: 'Sumber Hosted memerlukan identitas Supplier Admin.',
      });
    }
  });

export function SupplierCreatePage() {
  const navigate = useNavigate();
  const [credential, setCredential] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const form = useForm<z.infer<typeof supplierFormSchema>>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: { sourceMode: 'HOSTED', timezone: 'Asia/Jakarta' },
  });
  const sourceMode = form.watch('sourceMode');
  return (
    <>
      <PageHeader
        eyebrow="Provisioning supplier"
        title="Buat supplier"
        description="Timezone divalidasi sebagai IANA dan identitas Hosted memakai credential satu kali."
      />
      <Card className="tmmin-form-card">
        {credential ? (
          <OneTimeCredentialPanel
            clientId={credential.username}
            secret={credential.temporaryPassword}
            identifierLabel="Username"
            secretLabel="Temporary password"
            title="Simpan temporary credential sekarang"
            description="Temporary password hanya tersedia dalam memory pada halaman ini dan tidak dapat ditampilkan ulang."
            onAcknowledged={() => {
              setCredential(null);
              void navigate('/suppliers');
            }}
          />
        ) : (
          <form
            onSubmit={(event) =>
              void form.handleSubmit(async (values) => {
                const response = await tmminApi.createSupplier(
                  values.sourceMode === 'HOSTED'
                    ? {
                        code: values.code,
                        name: values.name,
                        timezone: values.timezone,
                        sourceMode: 'HOSTED',
                        supplierAdmin: {
                          username: values.adminUsername!,
                          displayName: values.adminName!,
                        },
                      }
                    : {
                        code: values.code,
                        name: values.name,
                        timezone: values.timezone,
                        sourceMode: 'EXTERNAL',
                      },
                );
                if (response.credential) setCredential(response.credential);
                else void navigate(`/suppliers/${response.supplier.id}`);
              })(event)
            }
          >
            <div className="tmmin-form-grid">
              <Field label="Supplier code" errorText={form.formState.errors.code?.message} required>
                <Input {...form.register('code')} />
              </Field>
              <Field label="Supplier name" errorText={form.formState.errors.name?.message} required>
                <Input {...form.register('name')} />
              </Field>
              <Field
                label="IANA timezone"
                errorText={form.formState.errors.timezone?.message}
                helperText="Example: Asia/Jakarta"
                required
              >
                <Input {...form.register('timezone')} />
              </Field>
              <Field label="Initial source" required>
                <NativeSelect {...form.register('sourceMode')}>
                  <option value="HOSTED">Hosted</option>
                  <option value="EXTERNAL">External</option>
                </NativeSelect>
              </Field>
              {sourceMode === 'HOSTED' && (
                <>
                  <Field
                    label="Supplier Admin username"
                    errorText={form.formState.errors.adminUsername?.message}
                    required
                  >
                    <Input {...form.register('adminUsername')} />
                  </Field>
                  <Field
                    label="Supplier Admin display name"
                    errorText={form.formState.errors.adminName?.message}
                    required
                  >
                    <Input {...form.register('adminName')} />
                  </Field>
                </>
              )}
            </div>
            {form.formState.errors.root && (
              <Alert tone="danger" title="Supplier tidak dapat dibuat">
                {form.formState.errors.root.message}
              </Alert>
            )}
            <div className="tmmin-actions">
              <Button onClick={() => void navigate('/suppliers')}>Batal</Button>
              <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
                Buat supplier
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}

export function SupplierDetailPage() {
  const { supplierId = '' } = useParams();
  const { session } = useTmminSession();
  const admin = session!.principal.role === 'TMMIN_ADMIN';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [credential, setCredential] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'supplier', supplierId),
    queryFn: () => tmminApi.supplier(supplierId),
  });
  const action = useMutation({
    mutationFn: (active: boolean) =>
      tmminApi.supplierAction(
        supplierId,
        active ? 'deactivate' : 'activate',
        result.data!.supplier.version,
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'supplier', supplierId),
      }),
  });
  if (result.isLoading) return <LoadingRows />;
  if (result.error || !result.data)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  const { supplier, monitoring } = result.data;
  return (
    <>
      <PageHeader
        eyebrow={`${supplier.code} · ${supplier.sourceMode} E${supplier.sourceEpoch}`}
        title={supplier.name}
        description="Identitas, administrasi, monitoring, dan konteks sumber supplier."
        actions={
          admin ? (
            <div className="tmmin-actions">
              <Button onClick={() => void navigate(`/source-governance?supplierId=${supplierId}`)}>
                Tata Kelola Sumber
              </Button>
              <AlertDialog
                trigger={
                  <Button variant={supplier.active ? 'danger' : 'primary'}>
                    {supplier.active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                }
                title={`${supplier.active ? 'Nonaktifkan' : 'Aktifkan'} supplier?`}
                description="Tindakan ini mengubah akses dan ketersediaan operasional. Versi diverifikasi server."
                confirmLabel={supplier.active ? 'Nonaktifkan' : 'Aktifkan'}
                destructive={supplier.active}
                onConfirm={() => action.mutate(supplier.active)}
              />
            </div>
          ) : undefined
        }
      />
      {credential && (
        <Card className="tmmin-secret-card">
          <OneTimeCredentialPanel
            clientId={credential.username}
            secret={credential.temporaryPassword}
            identifierLabel="Username"
            secretLabel="Temporary password"
            onAcknowledged={() => setCredential(null)}
          />
        </Card>
      )}
      <div className="tmmin-detail-layout">
        <div>
          <Panel title="Konteks supplier" description="Status registry authoritative">
            <KeyValueGrid
              columns={3}
              items={[
                { label: 'Code', value: supplier.code },
                { label: 'Timezone', value: supplier.timezone },
                {
                  label: 'Sumber',
                  value: `${supplier.sourceMode} · Epoch ${supplier.sourceEpoch}`,
                },
                { label: 'Status', value: supplier.active ? 'Aktif' : 'Nonaktif' },
                { label: 'Version', value: supplier.version },
                { label: 'Updated', value: dateTime(supplier.updatedAt) },
              ]}
            />
          </Panel>
          <Panel title="Ringkasan monitoring" description="Waktu data terakhir per sumber">
            <KeyValueGrid
              columns={3}
              items={[
                { label: 'Active warnings', value: monitoring.activeWarnings },
                { label: 'Hosted data time', value: dateTime(monitoring.lastHostedDataAt) },
                {
                  label: 'External ingestion time',
                  value: dateTime(monitoring.lastExternalIngestionAt),
                },
              ]}
            />
          </Panel>
          <SupplierAdminPanel
            admin={admin}
            supplierId={supplierId}
            current={result.data.currentSupplierAdmin}
            onCredential={setCredential}
            onChanged={() => void result.refetch()}
          />
          {admin && <SupplierEditPanel supplier={supplier} onSaved={() => void result.refetch()} />}
        </div>
        <aside className="tmmin-context-rail">
          <Alert
            tone={supplier.sourceMode === 'HOSTED' ? 'info' : 'warning'}
            title={`${supplier.sourceMode} is current`}
          >
            {supplier.sourceMode === 'HOSTED'
              ? 'Assignment Board and Hosted support reads are available.'
              : 'Hosted-only Board is unavailable; use External health and projection detail.'}
          </Alert>
          {result.data.activePreparation && (
            <Alert tone="warning" title="Persiapan Hosted aktif">
              Epoch {result.data.activePreparation.sourceEpoch} · started{' '}
              {dateTime(result.data.activePreparation.startedAt)}
            </Alert>
          )}
          <Link
            className="hds-button hds-button--secondary hds-button--md"
            to={`/suppliers/${supplierId}/credentials`}
          >
            External credentials
          </Link>
          <Link
            className="hds-button hds-button--secondary hds-button--md"
            to={`/hosted-support?supplierId=${supplierId}`}
          >
            Hosted support
          </Link>
        </aside>
      </div>
    </>
  );
}

const supplierAdminSchema = z.object({
  username: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(150),
});

function SupplierAdminPanel({
  admin,
  supplierId,
  current,
  onCredential,
  onChanged,
}: {
  admin: boolean;
  supplierId: string;
  current: {
    username: string;
    displayName: string;
    status: string;
    version: number;
  } | null;
  onCredential: (credential: { username: string; temporaryPassword: string }) => void;
  onChanged: () => void;
}) {
  const form = useForm<z.infer<typeof supplierAdminSchema>>({
    resolver: zodResolver(supplierAdminSchema),
  });
  const replace = form.handleSubmit(async (values) => {
    if (!current) return;
    const response = await tmminApi.replaceSupplierAdmin(supplierId, {
      ...values,
      expectedVersion: current.version,
    });
    onCredential(response.credential);
    form.reset();
    onChanged();
  });
  return (
    <Panel title="Supplier Admin" description="Hanya satu administrator aktif yang ditampilkan.">
      {current ? (
        <KeyValueGrid
          columns={3}
          items={[
            { label: 'Name', value: current.displayName },
            { label: 'Username', value: current.username },
            { label: 'Status', value: current.status },
          ]}
        />
      ) : (
        <p>Belum ada Supplier Admin aktif.</p>
      )}
      {admin && current && (
        <>
          <div className="tmmin-row-actions">
            <AlertDialog
              trigger={<Button size="sm">Reset temporary password</Button>}
              title={`Reset kata sandi ${current.username}?`}
              description="Semua session dicabut. Temporary password baru hanya ditampilkan sekali."
              confirmLabel="Reset kata sandi"
              onConfirm={() =>
                void (async () => {
                  const response = await tmminApi.resetSupplierAdmin(supplierId, current.version);
                  onCredential(response.credential);
                  onChanged();
                })()
              }
            />
          </div>
          <form className="tmmin-inline-form" onSubmit={(event) => event.preventDefault()}>
            <Field label="Replacement username" errorText={form.formState.errors.username?.message}>
              <Input {...form.register('username')} />
            </Field>
            <Field
              label="Replacement display name"
              errorText={form.formState.errors.displayName?.message}
            >
              <Input {...form.register('displayName')} />
            </Field>
            <AlertDialog
              trigger={
                <Button
                  type="button"
                  variant="danger"
                  disabled={!form.formState.isValid}
                  loading={form.formState.isSubmitting}
                >
                  Replace administrator
                </Button>
              }
              title="Ganti Supplier Admin saat ini?"
              description="Administrator lama dinonaktifkan dan seluruh session terkait sumber dicabut."
              confirmLabel="Replace administrator"
              destructive
              onConfirm={() => void replace()}
            />
          </form>
        </>
      )}
    </Panel>
  );
}

function SupplierEditPanel({
  supplier,
  onSaved,
}: {
  supplier: { id: string; name: string; timezone: string; version: number };
  onSaved: () => void;
}) {
  const schema = z.object({
    name: z.string().trim().min(1).max(200),
    timezone: z.string().trim().min(1).max(100),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: { name: supplier.name, timezone: supplier.timezone },
  });
  return (
    <Panel
      title="Ubah supplier"
      description="Nama dan timezone IANA memakai optimistic concurrency."
    >
      <form
        className="tmmin-inline-form"
        onSubmit={(event) =>
          void form.handleSubmit(async (values) => {
            await tmminApi.updateSupplier(supplier.id, {
              ...values,
              expectedVersion: supplier.version,
            });
            form.reset(values);
            onSaved();
          })(event)
        }
      >
        <Field label="Supplier name" errorText={form.formState.errors.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <Field label="IANA timezone" errorText={form.formState.errors.timezone?.message}>
          <Input {...form.register('timezone')} />
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={form.formState.isSubmitting}
          disabled={!form.formState.isDirty}
        >
          Simpan perubahan
        </Button>
      </form>
    </Panel>
  );
}

const governanceSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  privacyAcknowledged: z.boolean().refine((value) => value, 'Privacy acknowledgement is required.'),
});

export function SourceGovernancePage() {
  const { session } = useTmminSession();
  const admin = session!.principal.role === 'TMMIN_ADMIN';
  const [params] = useSearchParams();
  const supplierId = params.get('supplierId') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [preparationCredential, setPreparationCredential] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'source', supplierId),
    queryFn: () => tmminApi.source(supplierId),
    enabled: Boolean(supplierId),
  });
  const form = useForm<z.infer<typeof governanceSchema>>({
    resolver: zodResolver(governanceSchema),
    defaultValues: { privacyAcknowledged: false },
  });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof governanceSchema>) =>
      tmminApi.sourceCutover(supplierId, {
        targetMode: result.data!.preflight.targetMode,
        expectedVersion: result.data!.supplier.version,
        reason: values.reason,
        privacyAcknowledged: true,
      }),
    onSuccess: () => {
      form.reset();
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'source', supplierId),
      });
    },
  });
  const preparation = useMutation({
    mutationFn: (values: { reason: string; username: string; displayName: string }) =>
      tmminApi.startHostedPreparation(supplierId, {
        expectedVersion: result.data!.supplier.version,
        reason: values.reason,
        privacyAcknowledged: true,
        supplierAdmin: { username: values.username, displayName: values.displayName },
      }),
    onSuccess: (response) => {
      setPreparationCredential(response.credential);
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'source', supplierId),
      });
    },
  });
  if (!supplierId)
    return (
      <SupplierChooser
        title="Tata Kelola Sumber"
        description="Pilih supplier untuk meninjau preflight dan riwayat sumber."
        onSelect={(id) => void navigate(`/source-governance?supplierId=${id}`)}
      />
    );
  if (result.isLoading) return <LoadingRows />;
  if (result.error || !result.data)
    return <QueryState error={result.error} retry={() => void result.refetch()} />;
  const data = result.data;
  const ready = data.preflight.eligible;
  return (
    <>
      <PageHeader
        eyebrow={`${data.supplier.code} · Epoch sumber ${data.supplier.sourceEpoch}`}
        title="Tata Kelola Sumber"
        description="Kelola persiapan dan cutover sumber tunggal berdasarkan preflight server."
      />
      {admin && preparationCredential && (
        <Card className="tmmin-secret-card">
          <OneTimeCredentialPanel
            clientId={preparationCredential.username}
            secret={preparationCredential.temporaryPassword}
            identifierLabel="Preparation username"
            secretLabel="Temporary password"
            onAcknowledged={() => setPreparationCredential(null)}
          />
        </Card>
      )}
      <div className="tmmin-governance-summary">
        <div>
          <span>Supplier</span>
          <strong>{data.supplier.name}</strong>
          <small>{data.supplier.code}</small>
        </div>
        <div>
          <span>Sumber saat ini</span>
          <StatusBadge tone={data.supplier.sourceMode === 'HOSTED' ? 'success' : 'info'}>
            {data.supplier.sourceMode}
          </StatusBadge>
          <small>Epoch {data.supplier.sourceEpoch}</small>
        </div>
        <div>
          <span>Status persiapan</span>
          <StatusBadge tone={data.activePreparation ? 'warning' : 'neutral'}>
            {data.activePreparation ? 'AKTIF' : 'TIDAK AKTIF'}
          </StatusBadge>
          <small>{data.activePreparation ? dateTime(data.activePreparation.startedAt) : '—'}</small>
        </div>
        <div>
          <span>Status supplier</span>
          <StatusBadge tone={data.supplier.active ? 'success' : 'neutral'}>
            {data.supplier.active ? 'AKTIF' : 'NONAKTIF'}
          </StatusBadge>
          <small>{data.supplier.active ? 'Operasional' : 'Akses dibatasi'}</small>
        </div>
        <div>
          <span>Diperbarui</span>
          <strong>{dateTime(data.generatedAt)}</strong>
          <small>Preflight terbaru</small>
        </div>
      </div>
      <div className="tmmin-governance-hero">
        <section>
          <span>Perubahan yang diusulkan</span>
          <div>
            <StatusBadge tone={data.supplier.sourceMode === 'HOSTED' ? 'success' : 'info'}>
              {data.supplier.sourceMode}
            </StatusBadge>
            <ArrowRight aria-hidden="true" />
            <StatusBadge tone={data.preflight.targetMode === 'HOSTED' ? 'success' : 'info'}>
              {data.preflight.targetMode}
            </StatusBadge>
          </div>
          <p>Cutover membuat sumber lama read-only dan menaikkan source epoch.</p>
        </section>
        <section className={ready ? 'is-ready' : 'is-blocked'}>
          <div>
            <span>Kelayakan preflight</span>
            <StatusBadge tone={ready ? 'success' : 'danger'}>
              {ready ? 'SIAP' : 'TERBLOKIR'}
            </StatusBadge>
          </div>
          <dl>
            <div>
              <dt>Blocker</dt>
              <dd>{data.preflight.blockers.length}</dd>
            </div>
            <div>
              <dt>Target epoch</dt>
              <dd>{data.supplier.sourceEpoch + 1}</dd>
            </div>
            <div>
              <dt>Sumber target</dt>
              <dd>{data.preflight.targetMode}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="tmmin-detail-layout">
        <div>
          <Panel title="Blocker preflight" description="Evidence dihitung ulang oleh server">
            <div className="tmmin-table-scroll">
              <table className="tmmin-table tmmin-blocker-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Kode</th>
                    <th>Deskripsi</th>
                    <th>Contributor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.preflight.blockers.length ? (
                    data.preflight.blockers.map((blocker) => (
                      <tr key={`${blocker.contributor}-${blocker.code}`}>
                        <td>
                          <StatusBadge tone="danger">BLOCKER</StatusBadge>
                        </td>
                        <td>
                          <strong>{blocker.code}</strong>
                        </td>
                        <td>{blocker.detail}</td>
                        <td>{blocker.contributor}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td>
                        <StatusBadge tone="success">LULUS</StatusBadge>
                      </td>
                      <td>
                        <strong>SEMUA_PEMERIKSAAN_SIAP</strong>
                      </td>
                      <td>Tidak ada blocker aktif dari contributor preflight.</td>
                      <td>Server preflight</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Riwayat sumber" description="Evidence epoch dan cutover yang immutable">
            <Timeline
              items={data.history.map((entry) => ({
                title: `${entry.mode} · Epoch ${entry.epoch}`,
                description: entry.reason ?? sourceActionLabel(entry.action),
                meta: dateTime(entry.occurredAt),
                tone: entry.action === 'SUPPLIER_SOURCE_MODE_CHANGED' ? 'success' : 'neutral',
              }))}
            />
          </Panel>
          {admin && data.supplier.sourceMode === 'EXTERNAL' && (
            <PreparationPanel
              active={data.activePreparation}
              busy={preparation.isPending}
              onStart={(values) => preparation.mutate(values)}
              onCancel={async (reason) => {
                await tmminApi.cancelHostedPreparation(supplierId, {
                  expectedVersion: data.supplier.version,
                  reason,
                });
                await queryClient.invalidateQueries({
                  queryKey: tmminKey(session!.principal.userId, 'source', supplierId),
                });
              }}
            />
          )}
        </div>
        <aside className="tmmin-context-rail">
          {admin ? (
            <>
              <Alert
                tone={ready ? 'warning' : 'danger'}
                title={ready ? 'Perubahan berisiko tinggi' : 'Cutover terblokir'}
              >
                {ready
                  ? 'Cutover mencabut session dan credential yang terikat pada sumber lama.'
                  : 'Selesaikan setiap blocker hasil perhitungan server sebelum cutover.'}
              </Alert>
              <form
                className="tmmin-rail-form"
                onSubmit={(event) =>
                  void form.handleSubmit((values) => mutation.mutate(values))(event)
                }
              >
                <Field label="Alasan" errorText={form.formState.errors.reason?.message} required>
                  <Textarea rows={5} {...form.register('reason')} />
                </Field>
                <Checkbox
                  checked={form.watch('privacyAcknowledged')}
                  onCheckedChange={(checked) =>
                    form.setValue('privacyAcknowledged', checked === true, { shouldValidate: true })
                  }
                  label="Saya memahami konsekuensi privasi dan pencabutan credential."
                />
                <Button
                  type="submit"
                  variant="danger"
                  disabled={!ready}
                  loading={mutation.isPending}
                >
                  Cutover ke {data.preflight.targetMode}
                </Button>
              </form>
            </>
          ) : (
            <Alert tone="info" title="Ringkasan hanya baca">
              Quality dapat meninjau sumber, blocker, dan riwayat epoch. Kontrol perubahan sumber
              tidak ditampilkan.
            </Alert>
          )}
        </aside>
      </div>
    </>
  );
}

function PreparationPanel({
  active,
  busy,
  onStart,
  onCancel,
}: {
  active: { startedAt: string; sourceEpoch: number } | null;
  busy: boolean;
  onStart: (values: { reason: string; username: string; displayName: string }) => void;
  onCancel: (reason: string) => Promise<void>;
}) {
  const schema = z.object({
    reason: z.string().trim().min(10).max(1000),
    username: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(150),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const cancelForm = useForm<{ reason: string }>({
    resolver: zodResolver(z.object({ reason: z.string().trim().min(10).max(1000) })),
  });
  if (active)
    return (
      <Panel
        title="Persiapan Hosted aktif"
        description={`Epoch ${active.sourceEpoch} · dimulai ${dateTime(active.startedAt)}`}
      >
        <Alert tone="warning" title="Identitas persiapan terisolasi">
          Pembatalan mencabut session dan temporary credential persiapan.
        </Alert>
        <form
          className="tmmin-inline-form"
          onSubmit={(event) =>
            void cancelForm.handleSubmit(async ({ reason }) => {
              await onCancel(reason.trim());
              cancelForm.reset();
            })(event)
          }
        >
          <Field label="Alasan pembatalan" errorText={cancelForm.formState.errors.reason?.message}>
            <Textarea rows={3} {...cancelForm.register('reason')} />
          </Field>
          <Button type="submit" variant="danger" loading={cancelForm.formState.isSubmitting}>
            Batalkan persiapan
          </Button>
        </form>
      </Panel>
    );
  return (
    <Panel
      title="Mulai Persiapan Hosted"
      description="Hanya satu administrator persiapan terisolasi yang boleh aktif."
    >
      <form
        className="tmmin-form-grid"
        onSubmit={(event) => void form.handleSubmit(onStart)(event)}
      >
        <Field label="Alasan" errorText={form.formState.errors.reason?.message}>
          <Textarea {...form.register('reason')} />
        </Field>
        <Field label="Username Admin" errorText={form.formState.errors.username?.message}>
          <Input {...form.register('username')} />
        </Field>
        <Field label="Nama tampilan Admin" errorText={form.formState.errors.displayName?.message}>
          <Input {...form.register('displayName')} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          Mulai persiapan
        </Button>
      </form>
    </Panel>
  );
}

const clientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  ipAllowlist: z.string().trim(),
});

export function ExternalCredentialsPage() {
  const { supplierId = '' } = useParams();
  const { session } = useTmminSession();
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<{ clientId: string; clientSecret: string } | null>(
    null,
  );
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'external-clients', supplierId),
    queryFn: () => tmminApi.externalClients(supplierId, { limit: 100 }),
  });
  const form = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema) });
  const issue = useMutation({
    mutationFn: (values: z.infer<typeof clientSchema>) =>
      tmminApi.createExternalClient(supplierId, {
        name: values.name,
        ipAllowlist: values.ipAllowlist
          ? values.ipAllowlist
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
      }),
    onSuccess: (response) => {
      setCredential({ clientId: response.client.clientId, clientSecret: response.clientSecret });
      form.reset();
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'external-clients', supplierId),
      });
    },
  });
  const action = useMutation({
    mutationFn: ({
      id,
      version,
      action,
    }: {
      id: string;
      version: number;
      action: 'rotate-secret' | 'revoke';
    }) => tmminApi.externalClientAction(supplierId, id, action, version),
    onSuccess: (response, variables) => {
      if (variables.action === 'rotate-secret' && 'clientSecret' in response)
        setCredential({ clientId: response.client.clientId, clientSecret: response.clientSecret });
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'external-clients', supplierId),
      });
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="Keamanan sumber External"
        title="Credential External"
        description="Client epoch, scope, IP allowlist, status, penggunaan terakhir, rotasi, dan pencabutan."
      />
      {credential && (
        <Card className="tmmin-secret-card">
          <OneTimeCredentialPanel
            clientId={credential.clientId}
            secret={credential.clientSecret}
            onAcknowledged={() => setCredential(null)}
          />
        </Card>
      )}
      <Panel
        title="Terbitkan client"
        description="Secret baru hanya berada di memory sampai dikonfirmasi atau halaman ditinggalkan."
      >
        <form
          className="tmmin-inline-form"
          onSubmit={(event) => void form.handleSubmit((values) => issue.mutate(values))(event)}
        >
          <Field label="Client name" errorText={form.formState.errors.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="IP allowlist" helperText="Comma-separated exact IP values">
            <Input {...form.register('ipAllowlist')} />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={issue.isPending}
            leadingIcon={<KeyRound />}
          >
            Terbitkan credential
          </Button>
        </form>
      </Panel>
      {result.isLoading ? (
        <LoadingRows />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <Panel
          title="Client External"
          description="Operasi list tidak pernah mengembalikan secret."
        >
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Epoch / scope</th>
                  <th>IP allowlist</th>
                  <th>Status</th>
                  <th>Penggunaan terakhir</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.clientId}</small>
                    </td>
                    <td>
                      E{row.sourceEpoch}
                      <small>{row.scopes.join(', ')}</small>
                    </td>
                    <td>{row.ipAllowlist.length ? row.ipAllowlist.join(', ') : 'Any IP'}</td>
                    <td>
                      <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                        {row.active ? 'ACTIVE' : 'REVOKED'}
                      </StatusBadge>
                      <small>{row.validSecretCount} valid secret(s)</small>
                    </td>
                    <td>{dateTime(row.lastSuccessfulIngestionAt)}</td>
                    <td>
                      <div className="tmmin-actions">
                        {row.active && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                action.mutate({
                                  id: row.id,
                                  version: row.version,
                                  action: 'rotate-secret',
                                })
                              }
                            >
                              Rotasi
                            </Button>
                            <AlertDialog
                              trigger={
                                <Button size="sm" variant="danger">
                                  Cabut
                                </Button>
                              }
                              title="Cabut client External?"
                              description="Semua secret dan access token aktif untuk client ini akan dicabut."
                              confirmLabel="Cabut"
                              destructive
                              onConfirm={() =>
                                action.mutate({
                                  id: row.id,
                                  version: row.version,
                                  action: 'revoke',
                                })
                              }
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

const qualitySchema = z.object({
  username: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(150),
});

export function QualityUsersPage() {
  const { session } = useTmminSession();
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'quality-users'),
    queryFn: () => tmminApi.qualityUsers({ limit: 100, sort: 'USERNAME_ASC' }),
  });
  const form = useForm<z.infer<typeof qualitySchema>>({ resolver: zodResolver(qualitySchema) });
  const create = useMutation({
    mutationFn: (values: z.infer<typeof qualitySchema>) => tmminApi.createQualityUser(values),
    onSuccess: (response) => {
      setCredential(response.credential);
      form.reset();
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'quality-users'),
      });
    },
  });
  const action = useMutation({
    mutationFn: ({
      id,
      requestedAction,
      version,
    }: {
      id: string;
      requestedAction: 'deactivate' | 'reactivate' | 'reset-password';
      version: number;
    }) => tmminApi.qualityUserAction(id, requestedAction, version),
    onSuccess: (response) => {
      if ('credential' in response) setCredential(response.credential);
      void queryClient.invalidateQueries({
        queryKey: tmminKey(session!.principal.userId, 'quality-users'),
      });
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="Identitas monitoring hanya baca"
        title="Pengguna Quality TMMIN"
        description="Provisioning dan pemulihan akun Quality tanpa capability mutation."
      />
      {credential && (
        <Card className="tmmin-secret-card">
          <OneTimeCredentialPanel
            clientId={credential.username}
            secret={credential.temporaryPassword}
            identifierLabel="Username"
            secretLabel="Temporary password"
            onAcknowledged={() => setCredential(null)}
          />
        </Card>
      )}
      <Panel title="Buat pengguna Quality" description="Temporary password ditampilkan sekali.">
        <form
          className="tmmin-inline-form"
          onSubmit={(event) => void form.handleSubmit((values) => create.mutate(values))(event)}
        >
          <Field label="Username" errorText={form.formState.errors.username?.message}>
            <Input {...form.register('username')} />
          </Field>
          <Field label="Display name" errorText={form.formState.errors.displayName?.message}>
            <Input {...form.register('displayName')} />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            leadingIcon={<UserRoundPlus />}
          >
            Buat pengguna
          </Button>
        </form>
      </Panel>
      {result.isLoading ? (
        <LoadingRows />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <Panel title="Akun Quality" description="Role tetap TMMIN Quality dan hanya baca.">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Pengguna</th>
                  <th>Status</th>
                  <th>Status password</th>
                  <th>Diperbarui</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.displayName}</strong>
                      <small>{row.username}</small>
                    </td>
                    <td>
                      <StatusBadge tone={row.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td>{row.mustChangePassword ? 'Reset required' : 'Current'}</td>
                    <td>{dateTime(row.updatedAt)}</td>
                    <td>
                      <div className="tmmin-row-actions">
                        <AlertDialog
                          trigger={<Button size="sm">Reset kata sandi</Button>}
                          title={`Reset kata sandi ${row.username}?`}
                          description="Existing sessions are revoked and a new temporary password is displayed once."
                          confirmLabel="Reset kata sandi"
                          onConfirm={() =>
                            action.mutate({
                              id: row.id,
                              requestedAction: 'reset-password',
                              version: row.version,
                            })
                          }
                        />
                        <AlertDialog
                          trigger={
                            <Button
                              size="sm"
                              variant={row.status === 'ACTIVE' ? 'danger' : 'primary'}
                            >
                              {row.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan kembali'}
                            </Button>
                          }
                          title={`${row.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan kembali'} ${row.username}?`}
                          description={
                            row.status === 'ACTIVE'
                              ? 'The Quality user immediately loses monitoring access.'
                              : 'The Quality user regains read-only monitoring access.'
                          }
                          confirmLabel={
                            row.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan kembali'
                          }
                          destructive={row.status === 'ACTIVE'}
                          onConfirm={() =>
                            action.mutate({
                              id: row.id,
                              requestedAction:
                                row.status === 'ACTIVE' ? 'deactivate' : 'reactivate',
                              version: row.version,
                            })
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function SupplierChooser({
  title,
  description,
  onSelect,
}: {
  title: string;
  description: string;
  onSelect: (id: string) => void;
}) {
  const { session } = useTmminSession();
  const result = useQuery({
    queryKey: tmminKey(session!.principal.userId, 'supplier-chooser'),
    queryFn: () => tmminApi.suppliers({ limit: 100, status: 'ALL', sort: 'NAME_ASC' }),
  });
  return (
    <>
      <PageHeader eyebrow="Pilih konteks" title={title} description={description} />
      {result.data && (
        <div className="tmmin-chooser">
          {result.data.items.map((supplier) => (
            <Card key={supplier.id} interactive>
              <button type="button" onClick={() => onSelect(supplier.id)}>
                <span>{supplier.code}</span>
                <strong>{supplier.name}</strong>
                <small>
                  {supplier.sourceMode} · Epoch {supplier.sourceEpoch}
                </small>
                <ArrowRight />
              </button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
function LoadingRows() {
  return (
    <Card className="tmmin-table-skeleton">
      <RefreshCw className="hds-spinner" />
      <span>Memuat data authoritative…</span>
    </Card>
  );
}
function setSearch(
  params: URLSearchParams,
  setParams: (next: URLSearchParams) => void,
  key: string,
  value: string,
) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete('cursor');
  setParams(next);
}
function dateTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'No data';
}

function sourceActionLabel(action: string) {
  if (action === 'SUPPLIER_CREATED') return 'Supplier dibuat';
  if (action === 'HOSTED_PREPARATION_STARTED') return 'Persiapan Hosted dimulai';
  if (action === 'HOSTED_PREPARATION_CANCELLED') return 'Persiapan Hosted dibatalkan';
  if (action === 'SUPPLIER_SOURCE_MODE_CHANGED') return 'Source mode diubah';
  return action;
}
