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
        eyebrow="Supplier registry"
        title="Suppliers"
        description="Lifecycle, source mode, timezone, and current administration context."
        actions={
          admin ? (
            <Button
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => void navigate('/suppliers/new')}
            >
              Create supplier
            </Button>
          ) : undefined
        }
      />
      <div className="tmmin-filter-strip">
        <Input
          aria-label="Search suppliers"
          placeholder="Search code or name"
          defaultValue={params.get('search') ?? ''}
          onBlur={(event) => setSearch(params, setParams, 'search', event.target.value)}
        />
        <NativeSelect
          aria-label="Supplier status"
          value={query.status}
          onChange={(event) => setSearch(params, setParams, 'status', event.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Server sort"
          value={query.sort}
          onChange={(event) => setSearch(params, setParams, 'sort', event.target.value)}
        >
          <option value="NAME_ASC">Name A–Z</option>
          <option value="UPDATED_DESC">Recently updated</option>
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
          description="Server-side filtering and stable cursor ordering"
        >
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Source</th>
                  <th>Timezone</th>
                  <th>Status</th>
                  <th>Updated</th>
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
                      <Link to={`/suppliers/${row.id}`}>View</Link>
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
        message: 'Hosted source requires Supplier Admin identity.',
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
        eyebrow="Supplier provisioning"
        title="Create supplier"
        description="Timezone is validated as IANA and Hosted identity is provisioned with one-time credential."
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
              <Alert tone="danger" title="Supplier could not be created">
                {form.formState.errors.root.message}
              </Alert>
            )}
            <div className="tmmin-actions">
              <Button onClick={() => void navigate('/suppliers')}>Cancel</Button>
              <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
                Create supplier
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
        description="Supplier identity, administration, monitoring, and source context."
        actions={
          admin ? (
            <div className="tmmin-actions">
              <Button onClick={() => void navigate(`/source-governance?supplierId=${supplierId}`)}>
                Source governance
              </Button>
              <AlertDialog
                trigger={
                  <Button variant={supplier.active ? 'danger' : 'primary'}>
                    {supplier.active ? 'Deactivate' : 'Activate'}
                  </Button>
                }
                title={`${supplier.active ? 'Deactivate' : 'Activate'} supplier?`}
                description="This changes access and operational availability. Current version is verified by the server."
                confirmLabel={supplier.active ? 'Deactivate' : 'Activate'}
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
          <Panel title="Supplier context" description="Authoritative registry state">
            <KeyValueGrid
              columns={3}
              items={[
                { label: 'Code', value: supplier.code },
                { label: 'Timezone', value: supplier.timezone },
                {
                  label: 'Source',
                  value: `${supplier.sourceMode} · Epoch ${supplier.sourceEpoch}`,
                },
                { label: 'Status', value: supplier.active ? 'Active' : 'Inactive' },
                { label: 'Version', value: supplier.version },
                { label: 'Updated', value: dateTime(supplier.updatedAt) },
              ]}
            />
          </Panel>
          <Panel title="Monitoring summary" description="Source-specific last data timestamps">
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
            <Alert tone="warning" title="Hosted Preparation active">
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
    <Panel title="Supplier Admin" description="Only one current administrator is presented.">
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
        <p>No current Supplier Admin.</p>
      )}
      {admin && current && (
        <>
          <div className="tmmin-row-actions">
            <AlertDialog
              trigger={<Button size="sm">Reset temporary password</Button>}
              title={`Reset password for ${current.username}?`}
              description="All existing sessions are revoked. The replacement temporary password is displayed once."
              confirmLabel="Reset password"
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
              title="Replace the current Supplier Admin?"
              description="The current administrator is deactivated and all source-bound sessions are revoked."
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
    <Panel title="Edit supplier" description="Name and IANA timezone use optimistic concurrency.">
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
          Save changes
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
        title="Source Governance"
        description="Select a supplier to inspect computed preflight and source history."
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
        eyebrow={`${data.supplier.code} · Source epoch ${data.supplier.sourceEpoch}`}
        title="Source Governance"
        description="Computed preflight, blockers, readiness, privacy acknowledgement, and source epoch history."
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
          <span>Current source</span>
          <strong>{data.supplier.sourceMode}</strong>
        </div>
        <ArrowRight />
        <div>
          <span>Proposed target</span>
          <strong>{data.preflight.targetMode}</strong>
        </div>
        <div>
          <span>Readiness</span>
          <StatusBadge tone={ready ? 'success' : 'danger'}>
            {ready ? 'READY' : 'BLOCKED'}
          </StatusBadge>
        </div>
        <div>
          <span>Next epoch</span>
          <strong>{data.supplier.sourceEpoch + 1}</strong>
        </div>
      </div>
      <div className="tmmin-detail-layout">
        <div>
          <Panel title="Computed preflight" description="Reloadable server-computed readiness">
            <div className="tmmin-checks">
              {data.preflight.blockers.length ? (
                data.preflight.blockers.map((blocker) => (
                  <div key={`${blocker.contributor}-${blocker.code}`}>
                    <span>
                      <strong>{blocker.code}</strong>
                      <small>{blocker.detail}</small>
                    </span>
                    <StatusBadge tone="danger">BLOCKER</StatusBadge>
                  </div>
                ))
              ) : (
                <div>
                  <span>
                    <strong>ALL_CONTRIBUTORS_READY</strong>
                    <small>No active blocker was reported.</small>
                  </span>
                  <StatusBadge tone="success">PASSED</StatusBadge>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Source history" description="Epoch and cutover evidence">
            <Timeline
              items={data.history.map((entry) => ({
                title: `${entry.mode} · Epoch ${entry.epoch}`,
                description: entry.reason ?? entry.action,
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
                title={ready ? 'High-risk change' : 'Cutover blocked'}
              >
                {ready
                  ? 'Cutover revokes source-bound sessions and credentials. Confirm the operational consequence.'
                  : 'Resolve every server-computed blocker before cutover.'}
              </Alert>
              <form
                className="tmmin-rail-form"
                onSubmit={(event) =>
                  void form.handleSubmit((values) => mutation.mutate(values))(event)
                }
              >
                <Field label="Reason" errorText={form.formState.errors.reason?.message} required>
                  <Textarea rows={5} {...form.register('reason')} />
                </Field>
                <Checkbox
                  checked={form.watch('privacyAcknowledged')}
                  onCheckedChange={(checked) =>
                    form.setValue('privacyAcknowledged', checked === true, { shouldValidate: true })
                  }
                  label="I acknowledge the privacy and credential revocation consequences."
                />
                <Button
                  type="submit"
                  variant="danger"
                  disabled={!ready}
                  loading={mutation.isPending}
                >
                  Cut over to {data.preflight.targetMode}
                </Button>
              </form>
            </>
          ) : (
            <Alert tone="info" title="Read-only source summary">
              Quality can inspect current source, computed blockers, and immutable epoch history.
              Source changes and preparation controls are intentionally absent.
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
        title="Hosted Preparation active"
        description={`Epoch ${active.sourceEpoch} · started ${dateTime(active.startedAt)}`}
      >
        <Alert tone="warning" title="Preparation identity is isolated">
          Cancel revokes its session and temporary credential.
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
          <Field
            label="Cancellation reason"
            errorText={cancelForm.formState.errors.reason?.message}
          >
            <Textarea rows={3} {...cancelForm.register('reason')} />
          </Field>
          <Button type="submit" variant="danger" loading={cancelForm.formState.isSubmitting}>
            Cancel preparation
          </Button>
        </form>
      </Panel>
    );
  return (
    <Panel
      title="Start Hosted Preparation"
      description="Exactly one isolated preparation administrator may be active."
    >
      <form
        className="tmmin-form-grid"
        onSubmit={(event) => void form.handleSubmit(onStart)(event)}
      >
        <Field label="Reason" errorText={form.formState.errors.reason?.message}>
          <Textarea {...form.register('reason')} />
        </Field>
        <Field label="Admin username" errorText={form.formState.errors.username?.message}>
          <Input {...form.register('username')} />
        </Field>
        <Field label="Admin display name" errorText={form.formState.errors.displayName?.message}>
          <Input {...form.register('displayName')} />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          Start preparation
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
        eyebrow="External source security"
        title="External Credentials"
        description="Client epoch, least-privilege scope, IP allowlist, status, last use, rotation, and revocation."
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
        title="Issue client"
        description="The new secret remains in memory until acknowledged or navigation."
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
            Issue credential
          </Button>
        </form>
      </Panel>
      {result.isLoading ? (
        <LoadingRows />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <Panel
          title="External clients"
          description="Secrets are never returned by list operations."
        >
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Epoch / scope</th>
                  <th>IP allowlist</th>
                  <th>Status</th>
                  <th>Last use</th>
                  <th>Actions</th>
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
                              Rotate
                            </Button>
                            <AlertDialog
                              trigger={
                                <Button size="sm" variant="danger">
                                  Revoke
                                </Button>
                              }
                              title="Revoke External client?"
                              description="All active secrets and access tokens for this client will be revoked."
                              confirmLabel="Revoke"
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
        eyebrow="Read-only monitoring identities"
        title="TMMIN Quality Users"
        description="Provision and recover Quality accounts without granting mutation capabilities."
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
      <Panel title="Create Quality user" description="A temporary password is displayed once.">
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
            Create user
          </Button>
        </form>
      </Panel>
      {result.isLoading ? (
        <LoadingRows />
      ) : result.error || !result.data ? (
        <QueryState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <Panel title="Quality accounts" description="Role remains TMMIN Quality and read-only.">
          <div className="tmmin-table-scroll">
            <table className="tmmin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Password state</th>
                  <th>Updated</th>
                  <th>Actions</th>
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
                          trigger={<Button size="sm">Reset password</Button>}
                          title={`Reset password for ${row.username}?`}
                          description="Existing sessions are revoked and a new temporary password is displayed once."
                          confirmLabel="Reset password"
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
                              {row.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          }
                          title={`${row.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} ${row.username}?`}
                          description={
                            row.status === 'ACTIVE'
                              ? 'The Quality user immediately loses monitoring access.'
                              : 'The Quality user regains read-only monitoring access.'
                          }
                          confirmLabel={row.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
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
      <PageHeader eyebrow="Choose context" title={title} description={description} />
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
      <span>Loading authoritative data…</span>
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
