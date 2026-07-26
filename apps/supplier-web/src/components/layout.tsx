import {
  Bell,
  ClipboardCheck,
  Factory,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
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
  group: 'OPERASIONAL' | 'DATA' | 'SISTEM';
};

const navigation: NavigationItem[] = [
  {
    to: '/',
    label: 'Overview',
    capability: 'SUPPLIER_DASHBOARD_READ',
    icon: LayoutDashboard,
    group: 'OPERASIONAL',
  },
  {
    to: '/setup',
    label: 'Setup',
    capability: 'SUPPLIER_MASTER_DATA_READ',
    icon: Gauge,
    preparation: true,
    group: 'DATA',
  },
  {
    to: '/board',
    label: 'Assignment Board',
    capability: 'SUPPLIER_BOARD_READ',
    icon: Factory,
    group: 'OPERASIONAL',
  },
  {
    to: '/henkatens',
    label: 'Henkaten',
    capability: 'SUPPLIER_HENKATEN_READ',
    icon: ClipboardCheck,
    group: 'OPERASIONAL',
  },
  {
    to: '/approvals',
    label: 'Antrean Approval',
    capability: 'SUPPLIER_HENKATEN_DECIDE',
    icon: ShieldCheck,
    group: 'OPERASIONAL',
  },
  {
    to: '/shifts',
    label: 'Shift',
    capability: 'SUPPLIER_SHIFT_READ',
    icon: Settings2,
    group: 'OPERASIONAL',
  },
  {
    to: '/notifications',
    label: 'Notifikasi',
    capability: 'SUPPLIER_NOTIFICATION_READ',
    icon: Bell,
    group: 'SISTEM',
  },
  {
    to: '/master-data',
    label: 'Master Data',
    capability: 'SUPPLIER_MASTER_DATA_READ',
    icon: UsersRound,
    preparation: true,
    group: 'DATA',
  },
  {
    to: '/audit',
    label: 'Audit',
    capability: 'SUPPLIER_AUDIT_READ',
    icon: History,
    group: 'SISTEM',
  },
  {
    to: '/account',
    label: 'Akun',
    capability: 'SUPPLIER_SELF_SERVICE',
    icon: UserRound,
    preparation: true,
    group: 'SISTEM',
  },
];

const groupLabels = {
  OPERASIONAL: 'Operasional',
  DATA: 'Data & Konfigurasi',
  SISTEM: 'Sistem',
} as const;

export function ProductLayout() {
  const { session, hasCapability, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [supported, setSupported] = useState(
    () => window.innerWidth >= 1280 && window.innerHeight >= 720,
  );
  const [collapsed, setCollapsed] = useState(false);
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
  useEffect(() => {
    document.querySelector<HTMLElement>('#main-content h1')?.focus();
  }, [location.pathname]);

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
    <div className={`product-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}>
      <a className="product-skip" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="product-sidebar" aria-label="Navigasi Supplier">
        <BrandLockup context={preparation ? 'Hosted Preparation' : 'Supplier Portal'} />
        <div className="product-workspace">
          <span>{supplier.code}</span>
          <strong>{supplier.name}</strong>
          <small>{supplier.timezone}</small>
        </div>
        <nav aria-label="Navigasi utama">
          {Object.entries(groupLabels).map(([group, label]) => {
            const grouped = visibleNavigation.filter((item) => item.group === group);
            if (!grouped.length) return null;
            return (
              <section className="product-nav-group" key={group}>
                <span className="product-nav-group__label">{label}</span>
                {grouped.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
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
              </section>
            );
          })}
        </nav>
        <div className="product-sidebar__footer">
          <button
            type="button"
            aria-label={collapsed ? 'Perluas navigasi' : 'Ciutkan navigasi'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span>{collapsed ? 'Perluas' : 'Ciutkan navigasi'}</span>
          </button>
          <div>
            <Factory aria-hidden="true" />
            <span>
              <strong>{supplier.sourceMode}</strong>
              <small>Source epoch {supplier.sourceEpoch}</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="product-shell__main">
        <header className="product-topbar">
          <div>
            <span className="product-topbar__path">
              <small>Area aktif</small>
              {pageArea(location.pathname)}
            </span>
            <span className="product-topbar__supplier">
              <strong>{supplier.code}</strong>
              {supplier.name}
            </span>
          </div>
          <div className="product-topbar__actions">
            {hasCapability('SUPPLIER_NOTIFICATION_READ') && (
              <IconButton label="Buka notifikasi" onClick={() => void navigate('/notifications')}>
                <Bell />
                {(count.data?.count ?? 0) > 0 && <i>{count.data?.count}</i>}
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
  status,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
}) {
  useEffect(() => {
    document.querySelector<HTMLElement>('.product-page-header h1')?.focus();
  }, [title]);
  return (
    <header className="product-page-header">
      <div>
        {title !== 'Overview Supplier' && (
          <nav className="product-breadcrumbs" aria-label="Breadcrumb">
            <NavLink to="/">Supplier</NavLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{title}</span>
          </nav>
        )}
        {eyebrow && <span className="product-eyebrow">{eyebrow}</span>}
        <div className="product-page-header__title">
          <h1 tabIndex={-1}>{title}</h1>
          {status}
        </div>
        <p>{description}</p>
        {meta && <div className="product-page-header__meta">{meta}</div>}
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
