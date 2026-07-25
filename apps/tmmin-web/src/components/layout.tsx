import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Building2,
  CircleUserRound,
  ClipboardList,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Network,
  Settings2,
  ShieldCheck,
  Siren,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import type { Capability } from '@tmmin-henkaten/contracts';
import { BrandLockup, Button, IconButton, NativeSelect, Spinner } from '@tmmin-henkaten/ui';

import { tmminApi } from '../app/api';
import { tmminKey } from '../app/query';
import { useTmminSession } from '../app/session';

type Item = {
  to: string;
  label: string;
  capability: Capability;
  adminOnly?: boolean;
  monitor?: boolean;
  icon: typeof Gauge;
};

const items: Item[] = [
  {
    to: '/',
    label: 'Global Overview',
    capability: 'TMMIN_DASHBOARD_READ',
    monitor: true,
    icon: Gauge,
  },
  {
    to: '/warnings',
    label: 'Active Warnings',
    capability: 'TMMIN_HENKATEN_READ',
    monitor: true,
    icon: Siren,
  },
  {
    to: '/henkatens',
    label: 'Henkaten Explorer',
    capability: 'TMMIN_HENKATEN_READ',
    monitor: true,
    icon: Network,
  },
  { to: '/suppliers', label: 'Suppliers', capability: 'TMMIN_SUPPLIER_READ', icon: Building2 },
  {
    to: '/source-governance',
    label: 'Source Governance',
    capability: 'TMMIN_SUPPLIER_READ',
    icon: ShieldCheck,
  },
  {
    to: '/external-health',
    label: 'External Health',
    capability: 'TMMIN_HENKATEN_READ',
    monitor: true,
    icon: Activity,
  },
  {
    to: '/hosted-support',
    label: 'Hosted Support',
    capability: 'TMMIN_MASTER_DATA_READ',
    icon: ClipboardList,
  },
  {
    to: '/quality-users',
    label: 'Quality Users',
    capability: 'TMMIN_QUALITY_MANAGE',
    adminOnly: true,
    icon: UsersRound,
  },
  { to: '/audit', label: 'Audit', capability: 'TMMIN_AUDIT_READ', monitor: true, icon: History },
  {
    to: '/system-status',
    label: 'System Status',
    capability: 'TMMIN_DASHBOARD_READ',
    icon: Settings2,
  },
  { to: '/account', label: 'Account', capability: 'TMMIN_SUPPLIER_READ', icon: CircleUserRound },
];

export function TmminLayout() {
  const { session, hasCapability, logout } = useTmminSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [supported, setSupported] = useState(
    () => window.innerWidth >= 1280 && window.innerHeight >= 720,
  );
  const identity = session?.principal;
  const admin = identity?.role === 'TMMIN_ADMIN';
  const navigation = useMemo(
    () => items.filter((item) => hasCapability(item.capability) && (!item.adminOnly || admin)),
    [admin, hasCapability],
  );
  const supplierQuery = useQuery({
    queryKey: identity
      ? tmminKey(identity.userId, 'supplier-filter')
      : ['TMMIN', 'supplier-filter'],
    queryFn: () => tmminApi.suppliers({ limit: 100, status: 'ALL', sort: 'NAME_ASC' }),
    enabled: Boolean(identity),
  });
  const notificationQuery = useQuery({
    queryKey: identity
      ? tmminKey(identity.userId, 'notification-count')
      : ['TMMIN', 'notification-count'],
    queryFn: () => tmminApi.notificationCount(),
    enabled: Boolean(identity),
    refetchInterval: 60_000,
  });
  const monitor = items.some(
    (item) =>
      item.monitor &&
      (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)),
  );

  useEffect(() => {
    const update = () => setSupported(window.innerWidth >= 1280 && window.innerHeight >= 720);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    document.querySelector<HTMLElement>('#main-content h1')?.focus();
  }, [location.pathname]);

  if (!identity) return <Spinner label="Memuat TMMIN Portal" />;
  if (!supported) {
    return (
      <main className="tmmin-unsupported">
        <BrandLockup context="TMMIN Portal" />
        <section>
          <span className="tmmin-eyebrow">Viewport belum didukung</span>
          <h1>Gunakan layar desktop minimal 1280 × 720.</h1>
          <p>
            Monitoring lintas supplier membutuhkan ruang yang cukup untuk tabel dan konteks sumber.
          </p>
          <Button
            leadingIcon={<LogOut />}
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            Keluar dengan aman
          </Button>
        </section>
      </main>
    );
  }

  const shared = new URLSearchParams();
  if (params.get('supplierId')) shared.set('supplierId', params.get('supplierId')!);
  if (params.get('sourceMode')) shared.set('sourceMode', params.get('sourceMode')!);
  const withShared = (item: Item) =>
    item.monitor && shared.size ? `${item.to}?${shared.toString()}` : item.to;

  return (
    <div className="tmmin-product">
      <a className="tmmin-skip" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="tmmin-sidebar">
        <BrandLockup context="TMMIN Portal" />
        <div className="tmmin-workspace">
          <span>Enterprise Digital Henkaten</span>
          <strong>Governance Console</strong>
          <small>{admin ? 'Administration & monitoring' : 'Quality monitoring · Read only'}</small>
        </div>
        <nav aria-label="Navigasi utama">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={withShared(item)}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'is-current' : undefined)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="tmmin-sidebar__footer">
          <KeyRound aria-hidden="true" />
          <span>{admin ? 'Admin controls enabled' : 'Mutation controls hidden'}</span>
        </div>
      </aside>
      <div className="tmmin-product__main">
        <header className="tmmin-topbar">
          <div>
            <span className="tmmin-topbar__area">{pageArea(location.pathname)}</span>
            {monitor && (
              <div className="tmmin-global-filters" aria-label="Filter monitoring global">
                <NativeSelect
                  aria-label="Supplier"
                  value={params.get('supplierId') ?? ''}
                  onChange={(event) => {
                    const next = new URLSearchParams(params);
                    if (event.target.value) next.set('supplierId', event.target.value);
                    else next.delete('supplierId');
                    next.delete('cursor');
                    setParams(next);
                  }}
                >
                  <option value="">Semua supplier</option>
                  {supplierQuery.data?.items.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.code} · {supplier.name}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Source mode"
                  value={params.get('sourceMode') ?? ''}
                  onChange={(event) => {
                    const next = new URLSearchParams(params);
                    if (event.target.value) next.set('sourceMode', event.target.value);
                    else next.delete('sourceMode');
                    next.delete('cursor');
                    setParams(next);
                  }}
                >
                  <option value="">Hosted + External</option>
                  <option value="HOSTED">Hosted</option>
                  <option value="EXTERNAL">External</option>
                </NativeSelect>
              </div>
            )}
          </div>
          <div className="tmmin-topbar__actions">
            <IconButton label="Buka notifikasi" onClick={() => void navigate('/notifications')}>
              <Bell />
              {(notificationQuery.data?.count ?? 0) > 0 && <i>{notificationQuery.data?.count}</i>}
            </IconButton>
            <button
              className="tmmin-account"
              type="button"
              onClick={() => void navigate('/account')}
            >
              <span>{initials(identity.displayName)}</span>
              <span>
                <strong>{identity.displayName}</strong>
                <small>{admin ? 'TMMIN Admin' : 'TMMIN Quality'}</small>
              </span>
            </button>
            <IconButton label="Keluar" onClick={() => void logout().then(() => navigate('/login'))}>
              <LogOut />
            </IconButton>
          </div>
        </header>
        <main id="main-content" className="tmmin-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="tmmin-page-header">
      <div>
        {eyebrow && <span className="tmmin-eyebrow">{eyebrow}</span>}
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div>{actions}</div>}
    </header>
  );
}

function pageArea(path: string) {
  if (path === '/') return 'Global Overview';
  return items.find((item) => item.to !== '/' && path.startsWith(item.to))?.label ?? 'TMMIN Portal';
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
