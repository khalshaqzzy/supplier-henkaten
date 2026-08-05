import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Copy,
  Database,
  Factory,
  Gauge,
  Grid2X2,
  Info,
  Layers3,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Palette,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trash2,
  Type,
  Waypoints,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { tokenFamilies, type TokenEntry } from '../tokens';
import {
  Accordion,
  AlertDialog,
  AppShell,
  Breadcrumbs,
  Combobox,
  DatePicker,
  DateRange,
  Dialog,
  DropdownMenu,
  PanelHeader,
  Popover,
  Select,
  Sheet,
  Sidebar,
  Tabs,
  Tooltip,
  Topbar,
} from '../components/advanced';
import {
  Card,
  ChartFrame,
  DataTable,
  Divider,
  KeyValueGrid,
  Panel,
  StatCard,
  Stepper,
  Timeline,
  ToastViewport,
  toast,
} from '../components/data-display';
import {
  ApprovalRouteStatus,
  AssignmentJobCard,
  AssignmentState,
  BlockerCard,
  DomainFilterDemo,
  DomainMappingTable,
  FormErrorSummary,
  FreshnessStatus,
  NextAction,
  OneTimeSecretPanel,
  PersonCell,
  ReadinessCard,
  RealtimeStatus,
} from '../components/domain';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  ForbiddenState,
  IconButton,
  Input,
  Link,
  NativeSelect,
  Pagination,
  Progress,
  RadioGroup,
  SearchInput,
  SegmentedControl,
  Skeleton,
  Spinner,
  StaleState,
  StatusBadge,
  Switch,
  Textarea,
} from '../components/primitives';
import { ProductPatterns } from './patterns';

const sections = [
  ['overview', 'Overview'],
  ['tokens', 'Tokens'],
  ['components', 'Components'],
  ['domain', 'Domain'],
  ['patterns', 'Product patterns'],
  ['accessibility', 'Accessibility'],
  ['guidelines', 'Guidelines'],
] as const;

function DocsSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="hds-docs-section" id={id}>
      <header className="hds-docs-section__header">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function Specimen({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hds-specimen ${className ?? ''}`}>
      <header>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      <div className="hds-specimen__body">{children}</div>
    </div>
  );
}

function ColorTokens({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <div className="hds-color-grid">
      {entries.map((entry) => (
        <div className="hds-color-token" key={entry.name}>
          <span style={{ background: `var(${entry.cssVariable})` }} />
          <strong>{entry.name}</strong>
          <code>{entry.value}</code>
          <small>{entry.purpose}</small>
        </div>
      ))}
    </div>
  );
}

function TokenTable({ entries }: { entries: readonly TokenEntry[] }) {
  return (
    <div className="hds-token-table-wrap">
      <table className="hds-token-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Value</th>
            <th>Specimen</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.name}>
              <td>
                <code>{entry.cssVariable}</code>
              </td>
              <td>{entry.value}</td>
              <td>
                <TokenVisual entry={entry} />
              </td>
              <td>{entry.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenVisual({ entry }: { entry: TokenEntry }) {
  if (entry.name.startsWith('space-')) {
    return <span className="hds-space-token" style={{ width: `var(${entry.cssVariable})` }} />;
  }
  if (entry.name.startsWith('radius-')) {
    return (
      <span className="hds-radius-token" style={{ borderRadius: `var(${entry.cssVariable})` }} />
    );
  }
  if (entry.name.startsWith('shadow-')) {
    return <span className="hds-shadow-token" style={{ boxShadow: `var(${entry.cssVariable})` }} />;
  }
  if (entry.name.startsWith('duration-') || entry.name.startsWith('ease-')) {
    return <span className="hds-motion-token" />;
  }
  if (entry.name.startsWith('layer-')) {
    return <span className="hds-layer-token">{entry.value}</span>;
  }
  if (entry.name.startsWith('breakpoint-')) {
    return <span className="hds-breakpoint-token">{entry.value}</span>;
  }
  if (entry.name.startsWith('density-')) {
    return <span className="hds-density-token">Aa</span>;
  }
  if (entry.name.startsWith('focus-')) {
    return (
      <button type="button" className="hds-focus-token">
        Focus
      </button>
    );
  }
  return <span className="hds-generic-token" />;
}

function TypographyTokens() {
  const sizes = [
    ['11', '12', 'Utility label'],
    ['12', '13', 'Caption dan metadata'],
    ['13', '14', 'Default interface copy'],
    ['14', '15', 'Body copy'],
    ['16', '17', 'Lead copy'],
    ['18', '19', 'Section heading'],
    ['20', '22', 'Compact page heading'],
    ['24', '26', 'Page heading'],
    ['30', '32', 'Documentation display'],
  ] as const;
  return (
    <div className="hds-type-list">
      {sizes.map(([token, resolvedSize, label]) => (
        <div key={token}>
          <code>{resolvedSize}px</code>
          <span
            style={{
              fontSize: `var(--hds-type-${token}-size)`,
              lineHeight: `var(--hds-type-${token}-line)`,
            }}
          >
            {label}
          </span>
        </div>
      ))}
      <div className="hds-weight-row">
        {[
          ['regular', '400'],
          ['medium', '500'],
          ['semibold', '600'],
          ['bold', '700'],
        ].map(([weight, value]) => (
          <span key={weight} style={{ fontWeight: `var(--hds-weight-${weight})` }}>
            {weight} · {value}
          </span>
        ))}
      </div>
    </div>
  );
}

const demoChartData = [
  { label: 'Sen', open: 12, closed: 18 },
  { label: 'Sel', open: 16, closed: 22 },
  { label: 'Rab', open: 14, closed: 24 },
  { label: 'Kam', open: 19, closed: 28 },
  { label: 'Jum', open: 15, closed: 25 },
];

type DemoRow = {
  id: string;
  member: string;
  line: string;
  status: 'ASSIGNED' | 'VACANT' | 'RESERVED';
};
const demoRows: DemoRow[] = [
  { id: 'REG2305012', member: 'Rizky Pratama', line: 'SR CS Line', status: 'ASSIGNED' },
  { id: 'REG2401123', member: 'Dika Wijaya', line: 'SR CS Line', status: 'RESERVED' },
  { id: '—', member: 'Posisi terbuka', line: 'Recheck LH', status: 'VACANT' },
];
const demoColumns: ColumnDef<DemoRow, unknown>[] = [
  { accessorKey: 'id', header: 'Registration ID' },
  { accessorKey: 'member', header: 'Member' },
  { accessorKey: 'line', header: 'Line / Job' },
  {
    accessorKey: 'status',
    header: 'Assignment',
    cell: ({ row }) => <AssignmentState state={row.original.status} />,
  },
];

function ComponentCatalog() {
  const [page, setPage] = useState(1);
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState('compact');
  const [progress, setProgress] = useState(68);
  return (
    <div className="hds-catalog">
      <Specimen
        title="Actions"
        description="Default, hover specimen, danger, disabled, icon-only, dan layout-stable loading."
      >
        <div className="hds-state-matrix">
          <Button variant="primary" leadingIcon={<Plus />}>
            Primary
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" leadingIcon={<Trash2 />}>
            Danger
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="primary" loading>
            Submitting
          </Button>
          <IconButton label="Pengaturan">
            <Settings />
          </IconButton>
          <ButtonGroup>
            <Button>Approve</Button>
            <Button>
              <ChevronDown />
            </Button>
          </ButtonGroup>
          <Link href="#guidelines">Inline link</Link>
        </div>
      </Specimen>

      <Specimen
        title="Fields and inputs"
        description="Visible labels, helper/error association, readonly, disabled, search, date, select, dan combobox."
      >
        <div className="hds-input-grid">
          <Field
            label="Nama member"
            htmlFor="member-name"
            helperText="Gunakan nama sesuai master data."
          >
            <Input id="member-name" defaultValue="Rizky Pratama" />
          </Field>
          <Field
            label="Registration ID"
            htmlFor="registration"
            errorText="Registration ID sudah digunakan."
          >
            <Input id="registration" defaultValue="REG2305012" error />
          </Field>
          <Field label="Read only">
            <Input value="SR CS Line" readOnly />
          </Field>
          <Field label="Disabled">
            <Input value="Tidak tersedia" disabled />
          </Field>
          <Field label="Cari">
            <SearchInput label="Cari member" placeholder="Cari member…" />
          </Field>
          <Field label="Catatan">
            <Textarea placeholder="Tambahkan konteks…" />
          </Field>
          <Field label="Native select">
            <NativeSelect aria-label="Line">
              <option>SR CS Line</option>
              <option>SR DS Line</option>
            </NativeSelect>
          </Field>
          <Field label="Radix select">
            <Select
              label="Shift"
              defaultValue="white"
              options={[
                { value: 'white', label: 'White (Day)' },
                { value: 'night', label: 'Night' },
              ]}
            />
          </Field>
          <Field label="Combobox">
            <Combobox
              label="Member"
              options={[
                { value: 'Rizky Pratama', label: 'REG2305012' },
                { value: 'Dika Wijaya', label: 'REG2401123' },
              ]}
            />
          </Field>
          <Field label="Business date">
            <DatePicker label="Business date" defaultValue="2026-07-24" />
          </Field>
          <Field label="Rentang tanggal">
            <DateRange label="Rentang tanggal" startValue="2026-07-21" endValue="2026-07-24" />
          </Field>
        </div>
      </Specimen>

      <Specimen
        title="Selection controls"
        description="Controlled dan uncontrolled state dengan disabled treatment."
      >
        <div className="hds-selection-grid">
          <div>
            <Checkbox label="Published checklist" defaultChecked />
            <Checkbox label="Disabled option" disabled />
          </div>
          <RadioGroup
            label="Keputusan"
            defaultValue="approve"
            options={[
              { value: 'approve', label: 'Approve' },
              { value: 'reject', label: 'Reject' },
              { value: 'later', label: 'Tidak tersedia', disabled: true },
            ]}
          />
          <Switch
            checked={switchOn}
            onCheckedChange={setSwitchOn}
            label="Realtime updates"
            description={switchOn ? 'Terhubung' : 'Dijeda'}
          />
          <SegmentedControl
            label="Density"
            value={segment}
            onValueChange={setSegment}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'roomy', label: 'Roomy' },
            ]}
          />
        </div>
      </Specimen>

      <Specimen
        title="Navigation and overlays"
        description="Radix keyboard semantics, Escape handling, focus containment, outside click, dan focus return."
      >
        <div className="hds-overlay-grid">
          <Breadcrumbs
            items={[
              { label: 'Suppliers', href: '#components' },
              { label: 'PT Surya Komponen' },
              { label: 'Source Governance' },
            ]}
          />
          <Tabs
            label="Detail Henkaten"
            items={[
              { value: 'detail', label: 'Detail', content: <Card>Konten detail immutable.</Card> },
              {
                value: 'history',
                label: 'History',
                content: <Card>Timeline keputusan dan status.</Card>,
              },
              {
                value: 'audit',
                label: 'Audit',
                content: <Card>Permission-scoped audit trail.</Card>,
                disabled: true,
              },
            ]}
          />
          <div className="hds-state-matrix">
            <Tooltip label="Informasi ringkas saja">
              <IconButton label="Bantuan">
                <CircleHelp />
              </IconButton>
            </Tooltip>
            <DropdownMenu
              label="Action menu"
              trigger={<Button trailingIcon={<ChevronDown />}>Actions</Button>}
              items={[
                { label: 'Refresh data', icon: RefreshCw },
                { label: 'Copy link', icon: Copy },
                { label: 'Deactivate', icon: Trash2, destructive: true },
              ]}
            />
            <Popover trigger={<Button>Open popover</Button>} title="Freshness detail">
              <p>Event terakhir diterima 2 menit lalu.</p>
            </Popover>
            <Dialog
              trigger={<Button>Open dialog</Button>}
              title="Edit supplier"
              description="Changes are validated before save."
              footer={
                <>
                  <Button>Cancel</Button>
                  <Button variant="primary">Save</Button>
                </>
              }
            >
              <Field label="Supplier name">
                <Input defaultValue="PT Surya Komponen Indonesia" />
              </Field>
            </Dialog>
            <AlertDialog
              trigger={<Button variant="danger">High-impact action</Button>}
              title="Deactivate supplier?"
              description="Active sessions will end and new writes will be blocked."
              confirmLabel="Deactivate"
              destructive
            />
            <Sheet
              trigger={<Button>Open sheet</Button>}
              title="Atomic move"
              description="Source and target update in one transaction."
              footer={<Button variant="primary">Confirm move</Button>}
            >
              <KeyValueGrid
                columns={1}
                items={[
                  { label: 'Member', value: 'Andi Kurniawan' },
                  { label: 'Source', value: 'EG RM RH' },
                  { label: 'Target', value: 'EG RM LH2' },
                ]}
              />
            </Sheet>
          </div>
        </div>
      </Specimen>

      <Specimen
        title="Feedback and states"
        description="Icon + label + color; no status relies on color alone."
      >
        <div className="hds-feedback-stack">
          <div className="hds-state-matrix">
            <Badge>Neutral</Badge>
            <StatusBadge tone="info">Information</StatusBadge>
            <StatusBadge tone="success">Success</StatusBadge>
            <StatusBadge tone="warning">Warning</StatusBadge>
            <StatusBadge tone="danger">Danger</StatusBadge>
          </div>
          <Alert tone="info" title="Data diperbarui">
            Read model sudah disegarkan.
          </Alert>
          <Alert tone="success" title="Henkaten approved">
            Working assignment telah diperbarui.
          </Alert>
          <Alert tone="warning" title="Freshness aging">
            External event terakhir 18 menit lalu.
          </Alert>
          <Alert tone="danger" title="Conflict detected">
            Refresh data sebelum mengulangi keputusan.
          </Alert>
          <div className="hds-progress-demo">
            <Progress value={progress} label="Hosted preparation" />
            <Button size="sm" onClick={() => setProgress(progress >= 100 ? 20 : progress + 8)}>
              Advance
            </Button>
          </div>
          <div className="hds-state-matrix">
            <Spinner />
            <Skeleton className="hds-demo-skeleton" />
            <Button
              onClick={() =>
                toast.success('Perubahan disimpan', 'Source configuration berhasil diperbarui.')
              }
            >
              Show toast
            </Button>
          </div>
          <div className="hds-state-grid">
            <EmptyState
              title="Belum ada Henkaten"
              description="Buat Henkaten pertama untuk shift aktif."
              action={<Button variant="primary">Buat Henkaten</Button>}
            />
            <ErrorState
              title="Dashboard gagal dimuat"
              description="Koneksi terputus. Coba lagi tanpa kehilangan filter."
              action={<Button>Retry</Button>}
            />
            <ForbiddenState
              title="Akses tidak tersedia"
              description="Role Anda tidak memiliki capability untuk halaman ini."
            />
            <StaleState
              title="Data mungkin kedaluwarsa"
              description="Tampilan terakhir diperbarui 22 menit lalu."
              action={<Button>Refresh</Button>}
            />
          </div>
        </div>
      </Specimen>

      <Specimen
        title="Data display"
        description="Dense table, metrics, chart, timeline, stepper, accordion, dan key-value details."
      >
        <div className="hds-display-stack">
          <div className="hds-stat-grid hds-stat-grid--docs">
            <StatCard
              tone="info"
              label="Open Henkaten"
              value="28"
              trend="+12% vs 7 hari"
              trendDirection="up"
              icon={<ListChecks />}
            />
            <StatCard
              tone="warning"
              label="Active Warnings"
              value="11"
              detail="3 perlu perhatian"
              icon={<AlertTriangle />}
            />
            <StatCard
              tone="success"
              label="Readiness"
              value="92%"
              detail="2 blocker"
              icon={<Gauge />}
            />
          </div>
          <DataTable data={demoRows} columns={demoColumns} caption="Assignment example" />
          <ChartFrame
            title="Henkaten throughput"
            description="Sample data"
            data={demoChartData}
            xKey="label"
            series={[
              { dataKey: 'open', label: 'Open', color: 'var(--hds-chart-2)' },
              { dataKey: 'closed', label: 'Closed', color: 'var(--hds-chart-3)' },
            ]}
          />
          <Timeline
            items={[
              { title: 'Submitted', description: 'Daniel Arifin', meta: '09:15', tone: 'info' },
              {
                title: 'Supervisor approved',
                description: 'Bambang Haryono',
                meta: '09:22',
                tone: 'success',
              },
              {
                title: 'QC pending',
                description: 'Siti Nurlatifa',
                meta: 'Current',
                tone: 'warning',
                current: true,
              },
            ]}
          />
          <Stepper
            label="Hosted preparation"
            steps={[
              { label: 'Configuration', state: 'complete' },
              { label: 'Preflight', state: 'current' },
              { label: 'Acknowledgement', state: 'upcoming' },
              { label: 'Cutover', state: 'upcoming' },
            ]}
          />
          <Accordion
            items={[
              {
                value: 'scope',
                title: 'Apa yang divalidasi?',
                content: 'Contract, version, permission, dan business invariants.',
              },
              {
                value: 'conflict',
                title: 'Bagaimana konflik dipulihkan?',
                content: 'Refresh authoritative state; jangan silent overwrite.',
              },
            ]}
          />
          <Pagination page={page} pageCount={8} onPageChange={setPage} />
        </div>
      </Specimen>
    </div>
  );
}

function DomainCatalog() {
  return (
    <div className="hds-catalog">
      <Specimen
        title="Semantic mapping"
        description="Enum contract dipetakan ke icon, label, dan state token yang konsisten."
      >
        <DomainMappingTable />
      </Specimen>
      <Specimen title="Approval, freshness, and realtime">
        <div className="hds-state-matrix">
          <ApprovalRouteStatus route="SUPERVISOR" status="APPROVED" />
          <ApprovalRouteStatus route="QC" status="PENDING" />
          <FreshnessStatus state="fresh" timestamp="2 menit" />
          <FreshnessStatus state="aging" timestamp="18 menit" />
          <FreshnessStatus state="stale" timestamp="44 menit" />
          <RealtimeStatus connected />
          <RealtimeStatus connected={false} retrying />
          <RealtimeStatus connected={false} />
        </div>
      </Specimen>
      <Specimen title="Operational cells and filters">
        <div className="hds-display-stack">
          <PersonCell name="Rizky Pratama" identifier="REG2305012" role="MP" online />
          <DomainFilterDemo />
        </div>
      </Specimen>
      <Specimen title="Readiness and blockers">
        <div className="hds-readiness-grid">
          <ReadinessCard label="Members" state="ready" detail="128 member aktif" />
          <ReadinessCard label="Assignments" state="warning" detail="2 perlu review" />
          <ReadinessCard label="Checklist" state="blocked" detail="Belum published" />
          <ReadinessCard label="Preflight" state="not-run" detail="Jalankan pemeriksaan" />
        </div>
        <Divider />
        <BlockerCard
          title="Default assignments incomplete"
          description="12 line/job belum memiliki Supervisor atau Line Leader."
          count={12}
          action={<Button size="sm">Review assignments</Button>}
        />
      </Specimen>
      <Specimen title="Assignment job card">
        <div className="hds-job-grid">
          <AssignmentJobCard
            sequence="01"
            job="Spec 2"
            process="Cut & Spec"
            people={[
              { name: 'Rizky Pratama', id: 'REG2305012', state: 'ASSIGNED' },
              { state: 'VACANT' },
            ]}
          />
          <AssignmentJobCard
            sequence="02"
            job="EG RM LH2"
            process="Edge Grinding LH2"
            people={[
              { name: 'Dika Wijaya', id: 'REG2401123', state: 'CONFLICTED' },
              {
                name: 'Andi Kurniawan',
                id: 'REG2306078',
                state: 'RESERVED',
                reservation: 'Reserved until 14:00',
              },
            ]}
          />
        </div>
      </Specimen>
      <Specimen
        title="One-time secret handoff"
        description="Real acknowledgement behavior; sample value only."
      >
        <OneTimeSecretPanel clientId="hkn_ext_sample_7J4K" secret="sample_secret_not_valid_8F2P" />
      </Specimen>
      <Specimen title="Field-addressable validation">
        <FormErrorSummary
          errors={[
            { field: 'member', message: 'Member pengganti wajib dipilih.' },
            { field: 'reason', message: 'Alasan minimal 10 karakter.' },
          ]}
        />
      </Specimen>
      <Specimen title="Suggested next action">
        <NextAction
          title="Selesaikan vacancy terlebih dahulu"
          description="Job EG RM LH2 memiliki satu posisi kosong."
          actionLabel="Buka assignment"
        />
      </Specimen>
    </div>
  );
}

function OverviewShell({ context }: { context: 'supplier' | 'tmmin' }) {
  const supplier = context === 'supplier';
  const navItems = supplier
    ? [
        { label: 'Overview', href: '#overview-shell', icon: LayoutDashboard, current: true },
        { label: 'Assignment Board', href: '#overview-shell', icon: Grid2X2 },
        { label: 'Henkaten', href: '#overview-shell', icon: ListChecks, count: 6 },
        { label: 'Approvals', href: '#overview-shell', icon: ShieldCheck },
        { label: 'Master Data', href: '#overview-shell', icon: Database },
      ]
    : [
        { label: 'Global Overview', href: '#overview-shell', icon: LayoutDashboard, current: true },
        { label: 'Suppliers', href: '#overview-shell', icon: Factory },
        { label: 'Warnings', href: '#overview-shell', icon: AlertTriangle, count: 24 },
        { label: 'Henkaten', href: '#overview-shell', icon: ListChecks },
        { label: 'System Health', href: '#overview-shell', icon: Activity },
      ];
  return (
    <div className="hds-shell-demo" id="overview-shell">
      <AppShell
        sidebar={
          <Sidebar
            context={supplier ? 'Supplier Portal' : 'Global Governance'}
            items={navItems}
            footer="Sample shell · v0.1"
          />
        }
        topbar={
          <Topbar
            workspace={supplier ? 'PT Surya Komponen Indonesia' : 'TMMIN Quality Operations'}
            context={supplier ? 'Supplier workspace' : 'Cross-supplier monitoring'}
            userName="Daniel Arifin"
            role={supplier ? 'Supervisor' : 'Administrator'}
          />
        }
      >
        <PanelHeader
          title={supplier ? 'Supplier Overview' : 'Global Overview'}
          description={
            supplier
              ? 'Henkaten, approvals, dan operational health.'
              : 'Cross-supplier monitoring dan source health.'
          }
          actions={
            <Button variant="primary" leadingIcon={<Plus />}>
              {supplier ? 'Buat Henkaten' : 'Tambah supplier'}
            </Button>
          }
        />
        <div className="hds-stat-grid hds-stat-grid--shell">
          <StatCard
            tone="info"
            label={supplier ? 'Open Henkaten' : 'Active Suppliers'}
            value={supplier ? '28' : '24'}
            icon={<ListChecks />}
          />
          <StatCard
            tone="warning"
            label="Active Warnings"
            value={supplier ? '11' : '47'}
            icon={<AlertTriangle />}
          />
          <StatCard
            tone="success"
            label="Pending Approvals"
            value={supplier ? '23' : '68'}
            icon={<ShieldCheck />}
          />
          <StatCard
            tone="danger"
            label={supplier ? 'Assignment Issues' : 'Ingestion Aging'}
            value={supplier ? '8' : '3'}
            icon={<Gauge />}
          />
        </div>
      </AppShell>
    </div>
  );
}

function AccessibilitySection() {
  return (
    <div className="hds-a11y-grid">
      {[
        [
          LockKeyhole,
          'Keyboard contract',
          'Tab mengikuti urutan DOM. Arrow keys bekerja pada tabs/radio/menu; Escape menutup overlay.',
        ],
        [
          Palette,
          'Visible focus',
          'Ring biru 2 px dengan surface offset 2 px pada setiap target interaktif.',
        ],
        [
          Info,
          'Status semantics',
          'Icon dan label selalu menyertai warna pada lifecycle, approval, freshness, dan warning.',
        ],
        [
          RefreshCw,
          'Loading contract',
          'aria-busy, dimensions stabil, duplicate submit diblokir, dan static reduced-motion fallback.',
        ],
        [
          Type,
          'Readable content',
          'Inter Variable, hierarchy ringkas, visible labels, error terhubung ke field.',
        ],
        [
          Layers3,
          'Overlay behavior',
          'Focus contained, labelled title, outside-click policy, dan focus kembali ke trigger.',
        ],
      ].map(([Icon, title, description]) => {
        const IconComponent = Icon as typeof LockKeyhole;
        return (
          <Card key={String(title)}>
            <IconComponent />
            <strong>{title as string}</strong>
            <p>{description as string}</p>
          </Card>
        );
      })}
    </div>
  );
}

const coverage = {
  Actions: 'Button, IconButton, ButtonGroup, Link',
  Inputs:
    'Field, Input, SearchInput, Textarea, NativeSelect, Select, Combobox, DatePicker, DateRange, Checkbox, RadioGroup, Switch, SegmentedControl',
  Navigation:
    'AppShell, Sidebar, Topbar, WorkspaceSwitcher, AccountMenu, Breadcrumbs, Tabs, Pagination',
  Feedback:
    'Badge, StatusBadge, Alert, Toast, Progress, Spinner, Skeleton, EmptyState, ErrorState, ForbiddenState, StaleState',
  Overlays: 'Tooltip, DropdownMenu, Popover, Dialog, AlertDialog, Sheet, Drawer',
  Display:
    'Card, Panel, Divider, Avatar, KeyValueGrid, StatCard, DataTable, ChartFrame, ChartLegend, Timeline, Stepper, Accordion',
  Domain:
    'FourMIndicator, SourceModeBadge, HenkatenStatus, ApprovalRouteStatus, AssignmentState, FreshnessStatus, RealtimeStatus, PersonCell, FilterBar, ReadinessCard, BlockerCard, AssignmentJobCard, OneTimeSecretPanel, FormErrorSummary, LastUpdated',
};

export function DesignSystemShowcase() {
  const [context, setContext] = useState<'supplier' | 'tmmin'>('supplier');
  const [density, setDensity] = useState<'compact' | 'comfortable' | 'roomy'>('compact');
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const previous = document.title;
    document.title = 'Henkaten Design System';
    const meta = document.querySelector('meta[name="robots"]') ?? document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex,nofollow');
    if (!meta.parentNode) document.head.appendChild(meta);
    return () => {
      document.title = previous;
      meta.remove();
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    sections.forEach(([id]) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  const totalTokens = useMemo(
    () => Object.values(tokenFamilies).reduce((sum, family) => sum + family.length, 0),
    [],
  );

  return (
    <>
      <ToastViewport />
      <div className={`hds-docs hds-density--${density}`}>
        <aside className="hds-docs-nav">
          <a className="hds-docs-brand" href="#overview">
            <span>
              <Waypoints />
            </span>
            <span>
              <strong>Henkaten DS</strong>
              <small>Enterprise foundation</small>
            </span>
          </a>
          <nav aria-label="Design system sections">
            {sections.map(([id, label], index) => (
              <a
                key={id}
                href={`#${id}`}
                className={activeSection === id ? 'is-current' : undefined}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {label}
              </a>
            ))}
          </nav>
          <div className="hds-docs-nav__meta">
            <span>Light theme</span>
            <span>{totalTokens} tokens</span>
            <span>Sample data only</span>
          </div>
        </aside>
        <main className="hds-docs-main">
          <DocsSection
            id="overview"
            eyebrow="Henkaten Design System · v0.1"
            title="Operational clarity at enterprise density."
            description="Fondasi visual bersama untuk Supplier dan TMMIN. Diturunkan dari delapan reference screen: hierarchy tegas, surface netral, orange selektif, dan feedback operasional yang tidak ambigu."
          >
            <div className="hds-principle-grid">
              <Card>
                <Gauge />
                <strong>Compact by default</strong>
                <p>Informasi padat tetap terbaca dengan row 44 px dan control 36 px.</p>
              </Card>
              <Card>
                <ShieldCheck />
                <strong>Policy stays authoritative</strong>
                <p>Frontend menjelaskan blocker dan conflict; tidak memindahkan policy backend.</p>
              </Card>
              <Card>
                <Palette />
                <strong>Orange with restraint</strong>
                <p>
                  Accent untuk current navigation, primary action, dan emphasis—bukan semua status.
                </p>
              </Card>
              <Card>
                <Activity />
                <strong>State is explicit</strong>
                <p>
                  Icon, label, dan color bekerja bersama untuk realtime, freshness, dan lifecycle.
                </p>
              </Card>
            </div>
            <div className="hds-docs-controls">
              <div>
                <span>Context</span>
                <SegmentedControl
                  label="Context"
                  value={context}
                  onValueChange={(value) => setContext(value as 'supplier' | 'tmmin')}
                  options={[
                    { value: 'supplier', label: 'Supplier' },
                    { value: 'tmmin', label: 'TMMIN' },
                  ]}
                />
              </div>
              <div>
                <span>Density</span>
                <SegmentedControl
                  label="Density"
                  value={density}
                  onValueChange={(value) => setDensity(value as typeof density)}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'roomy', label: 'Roomy' },
                  ]}
                />
              </div>
              <div>
                <span>Theme</span>
                <Button disabled>Light only</Button>
              </div>
            </div>
            <OverviewShell context={context} />
            <Alert tone="info" title="Source analysis">
              Reference screenshots menjadi input visual, bukan kontrak behavior. Export, Save
              Draft, Skills, Calendars, extra source approval, auto-accept, dan tooling checks
              sengaja tidak diwarisi.
            </Alert>
          </DocsSection>

          <DocsSection
            id="tokens"
            eyebrow="01 · Foundations"
            title="Tokens"
            description="CSS variables adalah runtime source. Registry TypeScript menyediakan metadata typed untuk audit dan dokumentasi."
          >
            <div className="hds-catalog">
              <Specimen title="Raw neutral scale">
                <ColorTokens entries={tokenFamilies['Raw neutral']} />
              </Specimen>
              <Specimen title="TMMIN orange scale">
                <ColorTokens entries={tokenFamilies['Raw orange']} />
              </Specimen>
              <Specimen title="Semantic surfaces, text, border, and action">
                <ColorTokens entries={tokenFamilies.Semantic} />
              </Specimen>
              <Specimen title="State, source, and 4M semantics">
                <ColorTokens entries={tokenFamilies.States} />
              </Specimen>
              <Specimen title="Typography">
                <TypographyTokens />
              </Specimen>
              {(
                [
                  'Spacing',
                  'Shape',
                  'Elevation',
                  'Motion',
                  'Density',
                  'Layers',
                  'Breakpoints',
                  'Focus',
                  'Chart',
                  'Component',
                ] as const
              ).map((family) => (
                <Specimen
                  key={family}
                  title={family}
                  {...(family === 'Motion'
                    ? {
                        description:
                          'Motion is short, functional, interruptible, and reduced-motion safe.',
                      }
                    : {})}
                >
                  <TokenTable entries={tokenFamilies[family]} />
                </Specimen>
              ))}
            </div>
          </DocsSection>

          <DocsSection
            id="components"
            eyebrow="02 · Building blocks"
            title="Components"
            description="Production APIs dengan state nyata, keyboard behavior, controlled/uncontrolled usage, dan token-only implementation styling."
          >
            <ComponentCatalog />
          </DocsSection>

          <DocsSection
            id="domain"
            eyebrow="03 · Henkaten language"
            title="Domain components"
            description="Semantic wrappers menjaga lifecycle, approval, assignment, source, freshness, dan 4M konsisten di kedua application."
          >
            <DomainCatalog />
          </DocsSection>

          <DocsSection
            id="patterns"
            eyebrow="04 · Composed product proof"
            title="Eight critical product patterns"
            description="Specimen realistis berdasarkan reference images dan PAGES.md. Semua angka berlabel sample data dan tidak mewakili operasi aktual."
          >
            <ProductPatterns />
          </DocsSection>

          <DocsSection
            id="accessibility"
            eyebrow="05 · Interaction contract"
            title="Accessibility"
            description="Akses keyboard, focus, status, loading, dan recovery adalah bagian dari komponen—bukan dokumentasi tambahan."
          >
            <AccessibilitySection />
            <Panel title="Keyboard test path" description="Gunakan alur ini untuk audit manual.">
              <Stepper
                label="Keyboard audit"
                steps={[
                  { label: 'Tab controls', description: 'Focus visible', state: 'complete' },
                  { label: 'Arrow navigation', description: 'Tabs and radios', state: 'current' },
                  { label: 'Open overlay', description: 'Focus contained', state: 'upcoming' },
                  { label: 'Escape', description: 'Focus returns', state: 'upcoming' },
                ]}
              />
            </Panel>
          </DocsSection>

          <DocsSection
            id="guidelines"
            eyebrow="06 · Usage guidance"
            title="Guidelines and coverage"
            description="Aturan praktis agar implementasi halaman tetap konsisten, polished, dan mudah dipahami."
          >
            <div className="hds-do-dont">
              <Card>
                <Badge tone="success">Do</Badge>
                <h3>Prioritaskan next action.</h3>
                <p>Nyatakan blocker, dampak, dan jalur recovery dalam bahasa operasional.</p>
              </Card>
              <Card>
                <Badge tone="danger">Don’t</Badge>
                <h3>Jangan menyamarkan conflict.</h3>
                <p>
                  Refresh authoritative state dan minta pengguna memutuskan ulang; jangan silent
                  overwrite.
                </p>
              </Card>
              <Card>
                <Badge tone="success">Do</Badge>
                <h3>Gunakan density dengan konsisten.</h3>
                <p>
                  Compact untuk default table/dashboard; roomy hanya untuk konteks pengisian atau
                  review.
                </p>
              </Card>
              <Card>
                <Badge tone="danger">Don’t</Badge>
                <h3>Jangan memakai orange sebagai status universal.</h3>
                <p>Gunakan semantic family dan 4M contract; orange khusus brand/action/current.</p>
              </Card>
            </div>
            <Panel
              title="Public component coverage"
              description="Setiap item diekspor dari package barrel."
            >
              <div className="hds-coverage">
                {Object.entries(coverage).map(([group, items]) => (
                  <div key={group}>
                    <strong>{group}</strong>
                    <span>{items}</span>
                    <StatusBadge tone="success">Covered</StatusBadge>
                  </div>
                ))}
              </div>
            </Panel>
            <Alert tone="warning" title="Intentional scope">
              Light theme saja. Product experience tetap desktop minimum 1280 px; dokumentasi
              `/design` dirancang dapat diaudit pada tablet dan mobile.
            </Alert>
          </DocsSection>
        </main>
      </div>
    </>
  );
}
