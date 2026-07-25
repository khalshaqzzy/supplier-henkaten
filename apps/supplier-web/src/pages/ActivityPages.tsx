import { Bell, CheckCheck, ExternalLink, History, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  Input,
  NativeSelect,
  Panel,
  Skeleton,
} from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';
import { CursorPager } from '../components/CursorPager';
import { PageHeader } from '../components/layout';

export function NotificationsPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const scope = sessionScope(session!);
  const unreadOnly = params.get('unreadOnly') === 'true';
  const cursor = params.get('cursor') ?? undefined;
  const query = useQuery({
    queryKey: scopedKey(scope, 'notifications', { unreadOnly, cursor }),
    queryFn: () =>
      supplierApi.notifications({
        limit: 25,
        ...(cursor ? { cursor } : {}),
        ...(unreadOnly ? { unreadOnly } : {}),
      }),
  });
  const mark = useMutation({
    mutationFn: ({ id, version, read }: { id: string; version: number; read: boolean }) =>
      supplierApi.setNotificationRead(id, { read, expectedVersion: version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'notifications') });
      await queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'notification-count') });
    },
  });

  return (
    <div className="product-page">
      <PageHeader
        eyebrow="Perhatian dan tindak lanjut"
        title="Notifikasi"
        description="Event operasional sesuai permission Anda, dengan deep link yang diverifikasi kembali."
        actions={
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw />}
            onClick={() => void query.refetch()}
          >
            Perbarui
          </Button>
        }
      />
      <FilterBar>
        <label>
          <span>Tampilan</span>
          <NativeSelect
            value={unreadOnly ? 'true' : 'false'}
            onChange={(event) =>
              setParams(event.target.value === 'true' ? { unreadOnly: 'true' } : {}, {
                replace: true,
              })
            }
          >
            <option value="false">Semua notifikasi</option>
            <option value="true">Belum dibaca</option>
          </NativeSelect>
        </label>
      </FilterBar>
      {query.isLoading && <ListSkeleton />}
      {query.isError && (
        <ErrorState
          title="Notifikasi tidak dapat dimuat"
          description="Coba kembali tanpa kehilangan read state yang sudah tersimpan."
          action={<Button onClick={() => void query.refetch()}>Coba lagi</Button>}
        />
      )}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title={unreadOnly ? 'Tidak ada notifikasi baru' : 'Belum ada notifikasi'}
          description="Event yang memerlukan perhatian akan muncul di sini."
          action={
            unreadOnly ? (
              <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                Lihat semua
              </Button>
            ) : undefined
          }
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <ol className="notification-list">
            {query.data.items.map((item) => (
              <li key={item.id} className={item.readAt ? undefined : 'is-unread'}>
                <span className="notification-list__icon">
                  <Bell aria-hidden="true" />
                </span>
                <div>
                  <span>{humanize(item.kind)}</span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  <small>{formatDate(item.createdAt, session!.supplier!.timezone)}</small>
                </div>
                <div className="notification-list__actions">
                  {item.deepLink && (
                    <Link to={item.deepLink}>
                      Buka
                      <ExternalLink aria-hidden="true" />
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<CheckCheck />}
                    disabled={mark.isPending}
                    onClick={() =>
                      mark.mutate({ id: item.id, version: item.version, read: !item.readAt })
                    }
                  >
                    {item.readAt ? 'Tandai belum dibaca' : 'Tandai dibaca'}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
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

export function AuditPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = sessionScope(session!);
  const action = params.get('action') ?? '';
  const resourceType = params.get('resourceType') ?? '';
  const cursor = params.get('cursor') ?? undefined;
  const query = useQuery({
    queryKey: scopedKey(scope, 'audit', { action, resourceType, cursor }),
    queryFn: () =>
      supplierApi.audit({
        limit: 25,
        ...(cursor ? { cursor } : {}),
        ...(action ? { action } : {}),
        ...(resourceType ? { resourceType } : {}),
      }),
  });

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
        eyebrow="Immutable evidence"
        title="Audit"
        description="Riwayat domain dan keamanan sesuai tenant atau line scope Anda."
      />
      <FilterBar>
        <label>
          <span>Action</span>
          <Input
            value={action}
            placeholder="Contoh: HENKATEN_CREATED"
            onChange={(event) => update('action', event.target.value)}
          />
        </label>
        <label>
          <span>Resource</span>
          <Input
            value={resourceType}
            placeholder="Contoh: HENKATEN"
            onChange={(event) => update('resourceType', event.target.value)}
          />
        </label>
      </FilterBar>
      {query.isLoading && <ListSkeleton />}
      {query.isError && (
        <ErrorState
          title="Audit tidak dapat dimuat"
          description="Scope tidak diperluas di browser. Coba permintaan yang sama kembali."
          action={<Button onClick={() => void query.refetch()}>Coba lagi</Button>}
        />
      )}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="Belum ada riwayat"
          description={
            action || resourceType
              ? 'Tidak ada hasil untuk filter ini.'
              : 'Audit event akan muncul setelah ada aktivitas.'
          }
          action={
            action || resourceType ? (
              <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                Reset filter
              </Button>
            ) : undefined
          }
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <Panel
            title="Timeline audit"
            description={`${query.data.items.length} event pada halaman ini.`}
          >
            <ol className="audit-timeline">
              {query.data.items.map((item) => (
                <li key={item.id}>
                  <span>
                    <History aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{humanize(item.action)}</strong>
                    <p>
                      {item.actorRole ?? item.actorKind} · {item.resourceType}
                      {item.resourceId ? ` · ${item.resourceId}` : ''}
                    </p>
                    <small>
                      {formatDate(item.occurredAt, session!.supplier!.timezone)} · Correlation{' '}
                      {item.correlationId}
                    </small>
                  </div>
                  <code>{item.result}</code>
                </li>
              ))}
            </ol>
          </Panel>
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

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="Memuat data">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

function sessionScope(session: NonNullable<ReturnType<typeof useSession>['session']>) {
  return {
    userId: session.principal.userId,
    supplierId: session.supplier!.id,
    purpose: session.principal.purpose,
  };
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}
