import {
  Bell,
  ClipboardCheck,
  Factory,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Capability } from '@tmmin-henkaten/contracts';
import { BrandLockup, Button, IconButton, Spinner } from '@tmmin-henkaten/ui';

import { supplierApi } from '../app/api';
import { scopedKey } from '../app/query';
import { useSession } from '../app/session';

const roleLabels = {
  SUPPLIER_ADMIN: 'Supplier Admin',
  SUPERVISOR: 'Supervisor',
  LINE_LEADER: 'Line Leader',
  QC: 'Quality Control',
} as const;

type NavigationItem = {
  to: string;
  label: string;
  capability: Capability;
  icon: typeof Gauge;
  preparation?: boolean;
};

const navigation: NavigationItem[] = [
  { to: '/', label: 'Overview', capability: 'SUPPLIER_DASHBOARD_READ', icon: LayoutDashboard },
  {
    to: '/setup',
    label: 'Setup',
    capability: 'SUPPLIER_MASTER_DATA_READ',
    icon: Gauge,
    preparation: true,
  },
  { to: '/board', label: 'Assignment Board', capability: 'SUPPLIER_BOARD_READ', icon: Factory },
  {
    to: '/henkatens',
    label: 'Henkaten',
    capability: 'SUPPLIER_HENKATEN_READ',
    icon: ClipboardCheck,
  },
  {
    to: '/approvals',
    label: 'Approval Queue',
    capability: 'SUPPLIER_HENKATEN_DECIDE',
    icon: ShieldCheck,
  },
  { to: '/shifts', label: 'Shift', capability: 'SUPPLIER_SHIFT_READ', icon: Settings2 },
  {
    to: '/notifications',
    label: 'Notifikasi',
    capability: 'SUPPLIER_NOTIFICATION_READ',
    icon: Bell,
  },
  {
    to: '/master-data',
    label: 'Master Data',
    capability: 'SUPPLIER_MASTER_DATA_READ',
    icon: UsersRound,
    preparation: true,
  },
  { to: '/audit', label: 'Audit', capability: 'SUPPLIER_AUDIT_READ', icon: History },
  {
    to: '/account',
    label: 'Akun',
    capability: 'SUPPLIER_SELF_SERVICE',
    icon: UserRound,
    preparation: true,
  },
];

export function ProductLayout() {
  const { session, hasCapability, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [supported, setSupported] = useState(
    () => window.innerWidth >= 1280 && window.innerHeight >= 720,
  );
  const identity = session?.principal;
  const supplier = session?.supplier;
  const preparation = identity?.purpose === 'HOSTED_PREPARATION';
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(
        (item) => hasCapability(item.capability) && (!preparation || item.preparation === true),
      ),
    [hasCapability, preparation],
  );
  const count = useQuery({
    queryKey:
      identity && supplier
        ? scopedKey(
            {
              userId: identity.userId,
              supplierId: supplier.id,
              purpose: identity.purpose,
            },
            'notification-count',
          )
        : ['SUPPLIER', 'notification-count'],
    queryFn: () => supplierApi.notificationCount(),
    enabled: hasCapability('SUPPLIER_NOTIFICATION_READ'),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const update = () => setSupported(window.innerWidth >= 1280 && window.innerHeight >= 720);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!identity || !supplier) return <Spinner label="Memuat konteks Supplier" />;
  if (!supported) {
    return (
      <main className="product-unsupported">
        <BrandLockup context="Supplier Portal" />
        <div>
          <span className="product-eyebrow">Viewport belum didukung</span>
          <h1>Gunakan layar desktop minimal 1280 × 720.</h1>
          <p>
            Workflow operasional membutuhkan ruang untuk tabel, assignment, dan detail keputusan.
            Perbesar jendela atau buka aplikasi pada desktop.
          </p>
          <Button
            variant="secondary"
            leadingIcon={<LogOut />}
            onClick={() => void logout().then(() => navigate('/login'))}
          >
            Keluar
          </Button>
        </div>
      </main>
    );
  }

  return (
    <div className="product-shell">
      <a className="product-skip" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="product-sidebar">
        <BrandLockup context={preparation ? 'Hosted Preparation' : 'Supplier Portal'} />
        <div className="product-workspace">
          <span>{supplier.code}</span>
          <strong>{supplier.name}</strong>
          <small>{supplier.timezone}</small>
        </div>
        <nav aria-label="Navigasi utama">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'is-current' : undefined)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                {item.to === '/notifications' && (count.data?.count ?? 0) > 0 && (
                  <i aria-label={`${count.data?.count ?? 0} notifikasi belum dibaca`}>
                    {count.data?.count}
                  </i>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="product-sidebar__footer">
          <span>{supplier.sourceMode}</span>
          <small>Source epoch {supplier.sourceEpoch}</small>
        </div>
      </aside>
      <div className="product-shell__main">
        <header className="product-topbar">
          <div>
            <button type="button" className="product-menu" aria-label="Menu navigasi">
              <Menu aria-hidden="true" />
            </button>
            <span className="product-topbar__path">{pageArea(location.pathname)}</span>
          </div>
          <div className="product-topbar__actions">
            {hasCapability('SUPPLIER_NOTIFICATION_READ') && (
              <IconButton label="Buka notifikasi" onClick={() => void navigate('/notifications')}>
                <Bell />
              </IconButton>
            )}
            <button
              type="button"
              className="product-account"
              onClick={() => void navigate('/account')}
            >
              <span aria-hidden="true">{initials(identity.displayName)}</span>
              <span>
                <strong>{identity.displayName}</strong>
                <small>{roleLabels[identity.role as keyof typeof roleLabels]}</small>
              </span>
            </button>
            <IconButton label="Keluar" onClick={() => void logout().then(() => navigate('/login'))}>
              <LogOut />
            </IconButton>
          </div>
        </header>
        <main id="main-content" className="product-content" tabIndex={-1}>
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
  useEffect(() => {
    document.querySelector<HTMLElement>('.product-page-header h1')?.focus();
  }, [title]);
  return (
    <header className="product-page-header">
      <div>
        {eyebrow && <span className="product-eyebrow">{eyebrow}</span>}
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="product-page-header__actions">{actions}</div>}
    </header>
  );
}

function pageArea(pathname: string): string {
  if (pathname === '/') return 'Overview';
  return (
    navigation.find((item) => item.to !== '/' && pathname.startsWith(item.to))?.label ??
    'Supplier Portal'
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
