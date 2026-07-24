import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bell,
  BellRing,
  BriefcaseBusiness,
  Check,
  ClipboardCheck,
  Clock3,
  ChevronDown,
  Factory,
  FileClock,
  Gauge,
  ListChecks,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ActivityItem,
  Card,
  ChartFrame,
  DataTable,
  KeyValueGrid,
  Panel,
  StatCard,
  Stepper,
  Timeline,
} from '../components/data-display';
import {
  ApprovalRouteStatus,
  AssignmentJobCard,
  BlockerCard,
  FilterBar,
  FourMIndicator,
  FreshnessStatus,
  HenkatenStatus,
  LastUpdated,
  NextAction,
  PersonCell,
  ReadinessCard,
  RealtimeStatus,
  SourceModeBadge,
} from '../components/domain';
import { Breadcrumbs, PanelHeader, Sheet } from '../components/advanced';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  NativeSelect,
  RadioGroup,
  SearchInput,
  StatusBadge,
  Textarea,
} from '../components/primitives';

function PatternFrame({
  number,
  title,
  description,
  context,
  children,
}: {
  number: string;
  title: string;
  description: string;
  context: 'Supplier' | 'TMMIN';
  children: React.ReactNode;
}) {
  const supplier = context === 'Supplier';
  const current =
    title === 'Supplier Overview'
      ? 'Overview'
      : title === 'Assignment Board'
        ? 'Board'
        : title === 'Create Man Henkaten' || title === 'Henkaten Detail / Approval'
          ? 'Henkaten'
          : title === 'Blocked Shift Preflight'
            ? 'Shifts'
            : title === 'Default Assignment + Atomic Move'
              ? 'Master Data'
              : title === 'TMMIN Global Overview'
                ? 'Global Overview'
                : 'Suppliers';
  const navigation = supplier
    ? ['Overview', 'Board', 'Henkaten', 'Approvals', 'Shifts', 'Master Data', 'Audit']
    : ['Global Overview', 'Suppliers', 'Warnings', 'Henkaten', 'Ingestion Health', 'Audit'];
  return (
    <article className="hds-pattern">
      <header className="hds-pattern__header">
        <div>
          <span>{number}</span>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <Badge tone={context === 'Supplier' ? 'warning' : 'info'}>{context}</Badge>
      </header>
      <div className="hds-pattern__canvas">
        <div className="hds-pattern-shell">
          <aside className="hds-pattern-shell__sidebar">
            <div className="hds-pattern-shell__brand">
              <span>
                <Menu />
              </span>
              <div>
                <strong>TMMIN</strong>
                <small>{supplier ? 'Supplier Portal' : 'Global Console'}</small>
              </div>
            </div>
            <nav aria-label={`${title} specimen navigation`}>
              {navigation.map((item) => (
                <span key={item} className={item === current ? 'is-current' : undefined}>
                  <i aria-hidden="true" />
                  {item}
                  {item === 'Approvals' && <b>6</b>}
                </span>
              ))}
            </nav>
            <small className="hds-pattern-shell__version">© 2026 TMMIN · v0.1</small>
          </aside>
          <div className="hds-pattern-shell__main">
            <div className="hds-pattern-shell__topbar">
              <button type="button">
                <span>
                  <strong>{supplier ? 'PT Surya Komponen Indonesia' : 'Global'}</strong>
                  <small>{supplier ? 'Supplier Workspace' : 'All Suppliers'}</small>
                </span>
                <ChevronDown />
              </button>
              <div className="hds-pattern-shell__search">
                <Search />
                <span>
                  {supplier
                    ? 'Cari member, job, line, atau henkaten…'
                    : 'Cari supplier, source, atau henkaten…'}
                </span>
                <kbd>⌘K</kbd>
              </div>
              <div className="hds-pattern-shell__user">
                <span className="hds-live">
                  <i /> Live
                </span>
                <Bell />
                <span className="hds-avatar">DA</span>
                <span>
                  <strong>Daniel Arifin</strong>
                  <small>{supplier ? 'Supervisor' : 'Administrator'}</small>
                </span>
              </div>
            </div>
            <div className="hds-pattern-shell__content">
              <div className="hds-sample-label">Sample data</div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

const overviewTrend = [
  { day: 'Sen', open: 18, approved: 31, rejected: 4 },
  { day: 'Sel', open: 22, approved: 35, rejected: 3 },
  { day: 'Rab', open: 20, approved: 33, rejected: 5 },
  { day: 'Kam', open: 24, approved: 39, rejected: 4 },
  { day: 'Jum', open: 19, approved: 36, rejected: 2 },
  { day: 'Sab', open: 28, approved: 41, rejected: 4 },
];

export function SupplierOverviewPattern() {
  return (
    <PatternFrame
      number="01"
      title="Supplier Overview"
      description="Monitoring lintas 4M, approval, warning, dan isu assignment."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <PanelHeader
          title="Supplier Overview"
          description="Kondisi operasional PT Surya Komponen Indonesia."
          actions={
            <Button variant="primary" leadingIcon={<Plus />}>
              Buat Henkaten
            </Button>
          }
        />
        <FilterBar updatedAt="10:24 WIB" resultCount={28} onReset={() => undefined}>
          <Field label="Tanggal">
            <Input type="date" aria-label="Tanggal" defaultValue="2026-07-24" />
          </Field>
          <Field label="Line">
            <NativeSelect aria-label="Line">
              <option>Semua line</option>
              <option>SR CS Line</option>
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect aria-label="Status">
              <option>Semua status</option>
              <option>Open</option>
            </NativeSelect>
          </Field>
        </FilterBar>
        <div className="hds-stat-grid">
          <StatCard
            tone="info"
            label="Open Henkaten"
            value="28"
            trend="+12% vs 7 hari"
            trendDirection="up"
            icon={<FileClock />}
          />
          <StatCard
            tone="success"
            label="Approved"
            value="142"
            trend="+18% vs 7 hari"
            trendDirection="up"
            icon={<BadgeCheck />}
          />
          <StatCard
            tone="warning"
            label="Active Warnings"
            value="11"
            detail="3 perlu perhatian"
            icon={<AlertTriangle />}
          />
          <StatCard
            tone="info"
            label="Pending Approval"
            value="23"
            detail="16 Supervisor · 7 QC"
            icon={<ClipboardCheck />}
          />
          <StatCard
            tone="danger"
            label="Assignment Issues"
            value="8"
            detail="5 vacancy · 3 conflict"
            icon={<UsersRound />}
          />
          <StatCard
            tone="neutral"
            label="Shift Aktif"
            value="6"
            detail="2 berakhir < 1 jam"
            icon={<Clock3 />}
          />
        </div>
        <div className="hds-pattern-grid hds-pattern-grid--2-1">
          <ChartFrame
            title="Henkaten Trend (4M)"
            description="Enam hari operasional terakhir"
            data={overviewTrend}
            xKey="day"
            series={[
              { dataKey: 'open', label: 'Open', color: 'var(--hds-chart-2)' },
              { dataKey: 'approved', label: 'Approved', color: 'var(--hds-chart-3)' },
              { dataKey: 'rejected', label: 'Rejected', color: 'var(--hds-chart-5)' },
            ]}
          />
          <Panel title="Recent activity">
            <ActivityItem
              tone="success"
              title="HKM-260724-0012 approved"
              description="SR CS Line · EG RM LH2"
              time="10:18"
            />
            <ActivityItem
              tone="info"
              title="HKM-260724-0015 dibuat"
              description="Recheck LH · External Finish"
              time="10:05"
            />
            <ActivityItem
              tone="warning"
              title="Posisi kosong terdeteksi"
              description="SR CS Line · EG RM LH2"
              time="09:57"
            />
          </Panel>
        </div>
      </div>
    </PatternFrame>
  );
}

type QueueRow = {
  type: 'MAN' | 'MACHINE';
  id: string;
  job: string;
  status: 'OPEN' | 'APPROVED';
  requestor: string;
};

const queueColumns: ColumnDef<QueueRow, unknown>[] = [
  {
    accessorKey: 'type',
    header: '4M',
    cell: ({ row }) => <FourMIndicator category={row.original.type} />,
  },
  { accessorKey: 'id', header: 'Henkaten ID' },
  { accessorKey: 'job', header: 'Line / Job' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <HenkatenStatus status={row.original.status} />,
  },
  { accessorKey: 'requestor', header: 'Requested by' },
  { id: 'action', header: '', cell: () => <Button size="sm">Lihat</Button> },
];

const queueData: QueueRow[] = [
  {
    type: 'MAN',
    id: 'HKM-260724-0012',
    job: 'SR CS / EG RM LH2',
    status: 'OPEN',
    requestor: 'Daniel Arifin',
  },
  {
    type: 'MAN',
    id: 'HKM-260724-0013',
    job: 'SR CS / Recheck LH',
    status: 'OPEN',
    requestor: 'Siti Nurlatifa',
  },
  {
    type: 'MACHINE',
    id: 'HKM-260724-0009',
    job: 'SR CS / Ext. Finish',
    status: 'APPROVED',
    requestor: 'Fajar Maulana',
  },
];

export function AssignmentBoardPattern() {
  return (
    <PatternFrame
      number="02"
      title="Assignment Board"
      description="Working assignment real-time dengan vacancy, reservation, dan approval context."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <PanelHeader
          title="Supplier Assignment Board"
          description="Line SR CS · Shift White (Day)"
          actions={<RealtimeStatus connected />}
        />
        <FilterBar updatedAt="10:24 WIB">
          <Field label="Line">
            <NativeSelect aria-label="Line">
              <option>SR CS Line</option>
            </NativeSelect>
          </Field>
          <Field label="Shift">
            <NativeSelect aria-label="Shift">
              <option>White (Day)</option>
            </NativeSelect>
          </Field>
          <Field label="Business date">
            <Input type="date" aria-label="Business date" defaultValue="2026-07-24" />
          </Field>
        </FilterBar>
        <div className="hds-board-layout">
          <div>
            <div className="hds-stat-grid hds-stat-grid--compact">
              <StatCard tone="info" label="Active Jobs" value="12" icon={<BriefcaseBusiness />} />
              <StatCard tone="brand" label="Open Henkaten" value="3" icon={<ListChecks />} />
              <StatCard tone="warning" label="Pending Approval" value="2" icon={<Clock3 />} />
              <StatCard
                tone="danger"
                label="Assignment Issues"
                value="2"
                icon={<AlertTriangle />}
              />
            </div>
            <div className="hds-job-grid">
              <AssignmentJobCard
                sequence="01"
                job="Spec 2"
                process="Cut & Spec"
                people={[
                  { name: 'Rizky Pratama', id: 'REG2305012', state: 'ASSIGNED' },
                  { name: 'Budi Santoso', id: 'REG2305077', state: 'ASSIGNED' },
                ]}
              />
              <AssignmentJobCard
                sequence="02"
                job="EG RM LH2"
                process="Edge Grinding LH2"
                people={[
                  { name: 'Dika Wijaya', id: 'REG2401123', state: 'CONFLICTED' },
                  { state: 'VACANT' },
                ]}
              />
              <AssignmentJobCard
                sequence="03"
                job="EG RM RH"
                process="Edge Grinding RH"
                people={[
                  { name: 'Satria Nugroho', id: 'REG2304118', state: 'ASSIGNED' },
                  {
                    name: 'Andi Kurniawan',
                    id: 'REG2306078',
                    state: 'RESERVED',
                    reservation: 'SR DS Line sampai 14:00',
                  },
                ]}
              />
            </div>
            <Panel title="Approvals & Henkaten Queue">
              <DataTable
                data={queueData}
                columns={queueColumns}
                caption="Approval dan Henkaten queue"
              />
            </Panel>
          </div>
          <aside className="hds-context-rail">
            <BlockerCard
              title="Vacant Positions"
              description="EG RM LH2 memiliki 1 posisi terbuka."
              count={1}
              action={<Button size="sm">Assign sekarang</Button>}
            />
            <BlockerCard
              title="Reservation Conflict"
              description="EG RM RH masih direservasi line lain."
              count={1}
              action={<Button size="sm">Resolusi</Button>}
            />
            <NextAction
              title="Saran tindakan"
              description="Setujui 1 Henkaten MAN untuk mengisi vacancy."
              actionLabel="Review approval"
            />
          </aside>
        </div>
      </div>
    </PatternFrame>
  );
}

export function CreateManPattern() {
  return (
    <PatternFrame
      number="03"
      title="Create Man Henkaten"
      description="Form submission yang memandu target assignment, checklist, dan approval route."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <Breadcrumbs items={[{ label: 'Henkaten', href: '#patterns' }, { label: 'Buat Man' }]} />
        <PanelHeader
          title="Buat Man Henkaten"
          description="Perubahan tenaga kerja untuk working assignment aktif."
        />
        <Stepper
          label="Tahap pembuatan"
          steps={[
            { label: 'Target', state: 'complete' },
            { label: 'Perubahan', state: 'current' },
            { label: 'Checklist', state: 'upcoming' },
            { label: 'Review', state: 'upcoming' },
          ]}
        />
        <div className="hds-pattern-grid hds-pattern-grid--2-1">
          <div className="hds-form-stack">
            <Panel title="Target assignment" description="Dipilih dari shift yang sedang aktif.">
              <div className="hds-form-grid">
                <Field label="Line" required>
                  <NativeSelect aria-label="Line">
                    <option>SR CS Line</option>
                  </NativeSelect>
                </Field>
                <Field label="Job" required>
                  <NativeSelect aria-label="Job">
                    <option>02 · EG RM LH2</option>
                  </NativeSelect>
                </Field>
              </div>
              <Card selected className="hds-selected-assignment">
                <PersonCell name="Dika Wijaya" identifier="REG2401123" role="MP" online />
                <Badge tone="danger">Conflict terdeteksi</Badge>
              </Card>
            </Panel>
            <Panel title="Perubahan Man">
              <div className="hds-form-grid">
                <Field
                  label="Member pengganti"
                  required
                  helperText="Hanya member aktif dan eligible."
                >
                  <SearchInput label="Member pengganti" defaultValue="Rizky Pratama" />
                </Field>
                <Field label="Berlaku sampai" required>
                  <NativeSelect aria-label="Berlaku sampai">
                    <option>Akhir shift</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field label="Alasan perubahan" required>
                <Textarea
                  placeholder="Jelaskan alasan operasional…"
                  defaultValue="Penggantian sementara untuk menjaga kelangsungan job."
                />
              </Field>
            </Panel>
          </div>
          <aside className="hds-context-rail">
            <Panel title="Ringkasan">
              <KeyValueGrid
                columns={1}
                items={[
                  { label: 'Kategori', value: <FourMIndicator category="MAN" /> },
                  { label: 'Line / Job', value: 'SR CS / EG RM LH2' },
                  { label: 'Approval', value: 'Supervisor + QC paralel' },
                  { label: 'Berlaku', value: 'Sampai akhir shift' },
                ]}
              />
            </Panel>
            <Alert tone="warning" title="Validasi saat submit">
              Assignment, checklist aktif, dan availability member akan diperiksa ulang.
            </Alert>
            <Button variant="primary" size="lg">
              Lanjut ke checklist <ArrowRight />
            </Button>
          </aside>
        </div>
      </div>
    </PatternFrame>
  );
}

export function HenkatenDetailPattern() {
  return (
    <PatternFrame
      number="04"
      title="Henkaten Detail / Approval"
      description="Immutable submission detail, parallel route, dan keputusan beralasan."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <Breadcrumbs
          items={[{ label: 'Henkaten', href: '#patterns' }, { label: 'HKM-260724-0012' }]}
        />
        <PanelHeader
          title="HKM-260724-0012"
          description="Dibuat 24 Juli 2026 · 09:15 WIB oleh Daniel Arifin"
          actions={
            <>
              <FourMIndicator category="MAN" />
              <HenkatenStatus status="OPEN" />
            </>
          }
        />
        <div className="hds-pattern-grid hds-pattern-grid--2-1">
          <div className="hds-form-stack">
            <Panel title="Detail perubahan">
              <KeyValueGrid
                columns={3}
                items={[
                  { label: 'Line', value: 'SR CS Line' },
                  { label: 'Job', value: 'EG RM LH2' },
                  { label: 'Shift', value: 'White (Day)' },
                  { label: 'Member asal', value: 'Dika Wijaya' },
                  { label: 'Member pengganti', value: 'Rizky Pratama' },
                  { label: 'Berlaku', value: 'Sampai end shift' },
                ]}
              />
            </Panel>
            <Panel
              title="Checklist snapshot"
              description="Versi yang dipakai saat submit tidak berubah."
            >
              <div className="hds-checklist">
                {[
                  'Briefing keselamatan sudah dilakukan',
                  'Kesesuaian job telah diverifikasi',
                  'Instruksi kerja telah dipahami',
                ].map((item) => (
                  <div key={item}>
                    <CircleCheckIcon />
                    <span>{item}</span>
                    <Badge tone="success">Ya</Badge>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Riwayat">
              <Timeline
                items={[
                  {
                    title: 'Henkaten dibuat',
                    description: 'Daniel Arifin · Supervisor',
                    meta: '09:15',
                    tone: 'info',
                  },
                  {
                    title: 'Supervisor approved',
                    description: 'Bambang Haryono',
                    meta: '09:22',
                    tone: 'success',
                  },
                  {
                    title: 'Menunggu keputusan QC',
                    description: 'Siti Nurlatifa',
                    meta: 'Saat ini',
                    tone: 'warning',
                    current: true,
                  },
                ]}
              />
            </Panel>
          </div>
          <aside className="hds-context-rail">
            <Panel title="Approval route">
              <div className="hds-approval-stack">
                <ApprovalRouteStatus route="SUPERVISOR" status="APPROVED" />
                <ApprovalRouteStatus route="QC" status="PENDING" />
              </div>
            </Panel>
            <Panel
              title="Keputusan QC"
              description="Keputusan berlaku langsung dan tidak dapat diedit."
            >
              <RadioGroup
                label="Keputusan"
                defaultValue="approve"
                options={[
                  {
                    value: 'approve',
                    label: 'Approve',
                    description: 'Persyaratan kualitas terpenuhi.',
                  },
                  {
                    value: 'reject',
                    label: 'Reject',
                    description: 'Menutup route lain dengan reject-fast.',
                  },
                ]}
              />
              <Field label="Catatan keputusan">
                <Textarea placeholder="Tambahkan konteks keputusan…" />
              </Field>
              <Button variant="primary">Konfirmasi keputusan</Button>
            </Panel>
          </aside>
        </div>
      </div>
    </PatternFrame>
  );
}

function CircleCheckIcon() {
  return (
    <span className="hds-check-icon">
      <Check aria-hidden="true" />
    </span>
  );
}

export function BlockedShiftPattern() {
  return (
    <PatternFrame
      number="05"
      title="Blocked Shift Preflight"
      description="Preflight authoritative yang menjelaskan blocker dan recovery tanpa menyamarkan policy."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <PanelHeader
          title="Start Shift · White (Day)"
          description="SR CS Line · Business date 24 Juli 2026"
          actions={<StatusBadge tone="danger">Start blocked</StatusBadge>}
        />
        <Alert tone="danger" title="Shift belum dapat dimulai">
          Tiga blocker harus diselesaikan. Jalankan preflight kembali setelah semua resolusi
          selesai.
        </Alert>
        <div className="hds-pattern-grid hds-pattern-grid--2-1">
          <div className="hds-form-stack">
            <Panel title="Preflight summary" description="Pemeriksaan terakhir 10:17 WIB.">
              <div className="hds-readiness-grid">
                <ReadinessCard label="Shift template" state="ready" detail="White · 07:00–15:00" />
                <ReadinessCard label="Supervisor" state="ready" detail="Bambang Haryono" />
                <ReadinessCard label="Line Leader" state="ready" detail="Agus Setiawan" />
                <ReadinessCard label="Man assignments" state="blocked" detail="2 vacancy" />
                <ReadinessCard label="Reservations" state="warning" detail="1 lintas line" />
                <ReadinessCard label="Checklist" state="ready" detail="v7 · Published" />
              </div>
            </Panel>
            <Panel
              title="Blockers"
              action={
                <Button size="sm" leadingIcon={<RefreshCw />}>
                  Refresh preflight
                </Button>
              }
            >
              <div className="hds-blocker-list">
                <BlockerCard
                  title="Vacancy · EG RM LH2"
                  description="Posisi kedua belum memiliki member."
                  action={<Button size="sm">Resolve assignment</Button>}
                />
                <BlockerCard
                  title="Vacancy · Recheck LH"
                  description="Posisi pertama belum memiliki member."
                  action={<Button size="sm">Resolve assignment</Button>}
                />
                <BlockerCard
                  title="Reservation conflict"
                  description="Andi Kurniawan aktif di SR DS Line."
                  action={<Button size="sm">Review reservation</Button>}
                />
              </div>
            </Panel>
          </div>
          <aside className="hds-context-rail">
            <Panel title="Konsekuensi start">
              <ul className="hds-consequence-list">
                <li>Working assignments menjadi authoritative.</li>
                <li>Henkaten dapat diajukan pada shift ini.</li>
                <li>Business date dan timezone terkunci.</li>
              </ul>
            </Panel>
            <Alert tone="warning" title="Emergency override">
              Hanya Supplier Admin. Alasan wajib dan tindakan masuk audit.
            </Alert>
            <Button variant="primary" size="lg" disabled>
              Start shift
            </Button>
            <Button variant="danger">Emergency override</Button>
          </aside>
        </div>
      </div>
    </PatternFrame>
  );
}

export function DefaultAssignmentPattern() {
  return (
    <PatternFrame
      number="06"
      title="Default Assignment + Atomic Move"
      description="Konfigurasi role assignment dengan conflict-aware, versioned atomic move."
      context="Supplier"
    >
      <div className="hds-pattern-page">
        <PanelHeader
          title="Default Assignments"
          description="SR CS Line · konfigurasi yang digunakan saat shift berikutnya dibuat."
          actions={<LastUpdated value="10:02 WIB oleh Siti Nurlatifa" />}
        />
        <FilterBar resultCount={12}>
          <SearchInput label="Cari job atau member" placeholder="Cari job atau member…" />
          <Field label="Role">
            <NativeSelect aria-label="Role">
              <option>Semua role</option>
            </NativeSelect>
          </Field>
        </FilterBar>
        <div className="hds-assignment-config">
          {[
            {
              job: '01 · Spec 2',
              supervisor: 'Daniel Arifin',
              leader: 'Bambang Haryono',
              mp: 'Rizky Pratama, Budi Santoso',
            },
            {
              job: '02 · EG RM LH2',
              supervisor: 'Daniel Arifin',
              leader: 'Bambang Haryono',
              mp: 'Dika Wijaya, Vacant',
            },
            {
              job: '03 · EG RM RH',
              supervisor: 'Daniel Arifin',
              leader: 'Agus Setiawan',
              mp: 'Satria Nugroho, Andi Kurniawan',
            },
          ].map((row) => (
            <Card key={row.job} className="hds-assignment-row">
              <strong>{row.job}</strong>
              <KeyValueGrid
                columns={3}
                items={[
                  { label: 'Supervisor', value: row.supervisor },
                  { label: 'Line Leader', value: row.leader },
                  { label: 'MP', value: row.mp },
                ]}
              />
              <Sheet
                trigger={<Button size="sm">Move member</Button>}
                title="Move member"
                description="Perpindahan source dan target disimpan atomik."
                footer={
                  <>
                    <Button>Batal</Button>
                    <Button variant="primary">Konfirmasi move</Button>
                  </>
                }
              >
                <div className="hds-form-stack">
                  <Alert tone="info" title="Version check">
                    Source v12 dan target v8 akan diperiksa saat konfirmasi.
                  </Alert>
                  <Field label="Member">
                    <Input defaultValue="Andi Kurniawan" readOnly />
                  </Field>
                  <Field label="Dari">
                    <Input defaultValue="03 · EG RM RH" readOnly />
                  </Field>
                  <Field label="Ke target">
                    <NativeSelect aria-label="Ke target">
                      <option>02 · EG RM LH2</option>
                    </NativeSelect>
                  </Field>
                  <Checkbox label="Saya memahami donor job akan menjadi vacant" />
                </div>
              </Sheet>
            </Card>
          ))}
        </div>
      </div>
    </PatternFrame>
  );
}

type SupplierRow = {
  supplier: string;
  mode: 'HOSTED' | 'EXTERNAL';
  warnings: number;
  open: number;
  freshness: 'fresh' | 'aging' | 'stale';
};

const supplierColumns: ColumnDef<SupplierRow, unknown>[] = [
  { accessorKey: 'supplier', header: 'Supplier' },
  {
    accessorKey: 'mode',
    header: 'Source',
    cell: ({ row }) => <SourceModeBadge mode={row.original.mode} />,
  },
  { accessorKey: 'warnings', header: 'Warnings' },
  { accessorKey: 'open', header: 'Open Henkaten' },
  {
    accessorKey: 'freshness',
    header: 'Freshness',
    cell: ({ row }) => <FreshnessStatus state={row.original.freshness} />,
  },
  { id: 'action', header: '', cell: () => <Button size="sm">Monitor</Button> },
];

const supplierRows: SupplierRow[] = [
  {
    supplier: 'PT Surya Komponen Indonesia',
    mode: 'HOSTED',
    warnings: 3,
    open: 28,
    freshness: 'fresh',
  },
  {
    supplier: 'PT Astra Presisi Nusantara',
    mode: 'EXTERNAL',
    warnings: 8,
    open: 17,
    freshness: 'aging',
  },
  { supplier: 'PT Mitra Metalindo', mode: 'EXTERNAL', warnings: 5, open: 9, freshness: 'stale' },
  { supplier: 'PT Cipta Otomotif', mode: 'HOSTED', warnings: 1, open: 12, freshness: 'fresh' },
];

export function TmminOverviewPattern() {
  return (
    <PatternFrame
      number="07"
      title="TMMIN Global Overview"
      description="Cross-supplier monitoring yang membedakan Hosted dan External freshness."
      context="TMMIN"
    >
      <div className="hds-pattern-page">
        <PanelHeader
          title="Global Overview"
          description="Monitoring supplier, warning, approval aging, dan ingestion health."
          actions={<RealtimeStatus connected />}
        />
        <FilterBar updatedAt="10:24 WIB" resultCount={24} onReset={() => undefined}>
          <Field label="Source">
            <NativeSelect aria-label="Source">
              <option>Semua source</option>
              <option>Hosted</option>
              <option>External</option>
            </NativeSelect>
          </Field>
          <Field label="Status supplier">
            <NativeSelect aria-label="Status supplier">
              <option>Aktif</option>
            </NativeSelect>
          </Field>
          <Field label="Freshness">
            <NativeSelect aria-label="Freshness">
              <option>Semua freshness</option>
            </NativeSelect>
          </Field>
        </FilterBar>
        <div className="hds-stat-grid">
          <StatCard
            tone="success"
            label="Active Suppliers"
            value="24"
            detail="14 Hosted · 10 External"
            icon={<Factory />}
          />
          <StatCard
            tone="warning"
            label="Active Warnings"
            value="47"
            trend="+6 sejak kemarin"
            trendDirection="down"
            icon={<BellRing />}
          />
          <StatCard
            tone="brand"
            label="Open Henkaten"
            value="186"
            detail="Across 21 suppliers"
            icon={<ListChecks />}
          />
          <StatCard
            tone="danger"
            label="Approval > 24h"
            value="12"
            detail="5 supplier terdampak"
            icon={<Clock3 />}
          />
          <StatCard
            tone="info"
            label="Ingestion Aging"
            value="3"
            detail="External source"
            icon={<Gauge />}
          />
          <StatCard
            tone="success"
            label="Readiness"
            value="99.8%"
            detail="Core service ready"
            icon={<ShieldCheck />}
          />
        </div>
        <div className="hds-pattern-grid hds-pattern-grid--2-1">
          <Panel
            title="Supplier attention queue"
            description="Diurutkan berdasarkan risiko dan freshness."
          >
            <DataTable
              data={supplierRows}
              columns={supplierColumns}
              caption="Supplier attention queue"
            />
          </Panel>
          <Panel title="Affected parts">
            <div className="hds-ranked-list">
              {[
                ['Door Frame LH', '14 warnings'],
                ['Roof Moulding', '9 warnings'],
                ['Back Door Inner', '7 warnings'],
                ['Quarter Panel', '5 warnings'],
              ].map(([name, count], index) => (
                <div key={name}>
                  <span>{index + 1}</span>
                  <strong>{name}</strong>
                  <small>{count}</small>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </PatternFrame>
  );
}

export function SourceGovernancePattern() {
  return (
    <PatternFrame
      number="08"
      title="Source Governance"
      description="Hosted Preparation, preflight blocker, source epoch, dan cutover acknowledgement."
      context="TMMIN"
    >
      <div className="hds-pattern-page">
        <Breadcrumbs
          items={[
            { label: 'Suppliers', href: '#patterns' },
            { label: 'PT Surya Komponen' },
            { label: 'Source Governance' },
          ]}
        />
        <PanelHeader
          title="Source Governance"
          description="Pengelolaan source mode dan kesiapan cutover supplier."
          actions={<Button variant="primary">Mulai preparation</Button>}
        />
        <Panel>
          <KeyValueGrid
            columns={4}
            items={[
              { label: 'Supplier', value: 'PT Surya Komponen Indonesia' },
              { label: 'Current mode', value: <SourceModeBadge mode="EXTERNAL" /> },
              {
                label: 'Preparation',
                value: <StatusBadge tone="warning">Hosted Preparation active</StatusBadge>,
              },
              { label: 'Source epoch', value: 'EPOCH-2026-07-15-001' },
            ]}
          />
        </Panel>
        <div className="hds-governance-layout">
          <div className="hds-form-stack">
            <div className="hds-cutover-summary">
              <Card>
                <span>Proposed change</span>
                <div>
                  <SourceModeBadge mode="EXTERNAL" />
                  <ArrowRight />
                  <SourceModeBadge mode="HOSTED" />
                </div>
              </Card>
              <Card>
                <span>Preflight eligibility</span>
                <strong className="hds-danger-text">
                  <AlertTriangle /> Blocked
                </strong>
                <small>3 blocker · 1 warning · 8 passed</small>
              </Card>
            </div>
            <Panel title="Blockers" action={<Button size="sm">Refresh preflight</Button>}>
              <div className="hds-blocker-list">
                <BlockerCard
                  title="Checklist belum published"
                  description="Versi checklist untuk source target belum tersedia."
                />
                <BlockerCard
                  title="Default assignments incomplete"
                  description="12 line/job belum memiliki assignment lengkap."
                />
                <BlockerCard
                  title="Resources aktif"
                  description="2 reservation dan 3 Henkaten open harus diselesaikan."
                />
              </div>
            </Panel>
            <Panel title="Readiness">
              <div className="hds-readiness-grid">
                <ReadinessCard label="Supplier Admin" state="ready" detail="2 akun aktif" />
                <ReadinessCard label="Shift Templates" state="ready" detail="6 template" />
                <ReadinessCard label="Members" state="ready" detail="128 member" />
                <ReadinessCard label="Lines / Jobs" state="blocked" detail="2 issue" />
                <ReadinessCard label="Parts" state="ready" detail="4.286 part" />
                <ReadinessCard label="Checklists" state="blocked" detail="1 issue" />
              </div>
            </Panel>
          </div>
          <aside className="hds-context-rail">
            <Alert tone="danger" title="High-risk action">
              Cutover akan mencabut source permission lama dan membuat epoch baru.
            </Alert>
            <Panel title="Acknowledgement">
              <Field label="Alasan perubahan" required>
                <Textarea placeholder="Jelaskan kebutuhan cutover…" />
              </Field>
              <Checkbox label="Saya memahami source lama akan dicabut setelah cutover berhasil." />
            </Panel>
            <Button variant="primary" size="lg" disabled>
              Cutover ke Hosted
            </Button>
          </aside>
        </div>
      </div>
    </PatternFrame>
  );
}

export function ProductPatterns() {
  return (
    <div className="hds-pattern-list">
      <SupplierOverviewPattern />
      <AssignmentBoardPattern />
      <CreateManPattern />
      <HenkatenDetailPattern />
      <BlockedShiftPattern />
      <DefaultAssignmentPattern />
      <TmminOverviewPattern />
      <SourceGovernancePattern />
    </div>
  );
}
