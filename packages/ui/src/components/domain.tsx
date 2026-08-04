import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Copy,
  Database,
  Radio,
  RefreshCw,
  ShieldAlert,
  UserRound,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type {
  ApprovalRouteStatus as ApprovalRouteStatusValue,
  HenkatenCategory,
  HenkatenStatus as HenkatenStatusValue,
  SourceMode,
  WorkingAssignmentState,
} from '@tmmin-henkaten/contracts';
import { cn } from '../lib/utils';
import { Avatar, Card, KeyValueGrid } from './data-display';
import {
  Alert,
  Badge,
  Button,
  Field,
  NativeSelect,
  SearchInput,
  StatusBadge,
  type Tone,
} from './primitives';

const categoryMeta: Record<HenkatenCategory, { label: string; className: string }> = {
  MAN: { label: 'Man', className: 'hds-4m--man' },
  MACHINE: { label: 'Machine', className: 'hds-4m--machine' },
  MATERIAL: { label: 'Material', className: 'hds-4m--material' },
  METHOD: { label: 'Method', className: 'hds-4m--method' },
};

export function FourMIndicator({
  category,
  compact = false,
}: {
  category: HenkatenCategory;
  compact?: boolean;
}) {
  const meta = categoryMeta[category];
  return (
    <span className={cn('hds-4m', meta.className, compact && 'is-compact')}>
      <i aria-hidden="true" />
      {meta.label}
    </span>
  );
}

const categoryOrder: HenkatenCategory[] = ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'];

export function FourMDot({
  category,
  className,
}: {
  category: HenkatenCategory;
  className?: string;
}) {
  return (
    <span
      className={cn('hds-4m-dot', `hds-4m-dot--${category.toLowerCase()}`, className)}
      aria-hidden="true"
    />
  );
}

export function FourMLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('hds-4m-legend', className)} aria-label="Kategori Henkaten 4M">
      {categoryOrder.map((category) => {
        const label = categoryMeta[category].label;
        return (
          <li key={category} aria-label={label}>
            <FourMDot category={category} />
            <span aria-hidden="true">
              <strong>M</strong>
              {label.slice(1)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SourceModeBadge({ mode }: { mode: SourceMode }) {
  return (
    <span className={cn('hds-source-mode', `hds-source-mode--${mode.toLowerCase()}`)}>
      <Database aria-hidden="true" />
      {mode === 'HOSTED' ? 'Hosted' : 'External'}
    </span>
  );
}

const henkatenMeta: Record<HenkatenStatusValue, { tone: Tone; label: string }> = {
  OPEN: { tone: 'info', label: 'Open' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

export function HenkatenStatus({ status }: { status: HenkatenStatusValue }) {
  const meta = henkatenMeta[status];
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

const approvalMeta: Record<ApprovalRouteStatusValue, { tone: Tone; label: string }> = {
  PENDING: { tone: 'warning', label: 'Pending' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  NOT_REQUIRED: { tone: 'neutral', label: 'Not required' },
};

export function ApprovalRouteStatus({
  route,
  status,
}: {
  route: 'SUPERVISOR' | 'QC';
  status: ApprovalRouteStatusValue;
}) {
  const meta = approvalMeta[status];
  return (
    <StatusBadge tone={meta.tone}>
      {route === 'SUPERVISOR' ? 'Supervisor' : 'QC'} · {meta.label}
    </StatusBadge>
  );
}

const assignmentMeta: Record<
  WorkingAssignmentState,
  { tone: Tone; label: string; icon: LucideIcon }
> = {
  ASSIGNED: { tone: 'success', label: 'Assigned', icon: CircleCheck },
  VACANT: { tone: 'danger', label: 'Vacant', icon: CircleDashed },
  CONFLICTED: { tone: 'danger', label: 'Conflicted', icon: CircleAlert },
  RESERVED: { tone: 'warning', label: 'Reserved', icon: Clock3 },
};

export function AssignmentState({ state }: { state: WorkingAssignmentState }) {
  const meta = assignmentMeta[state];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} className="hds-domain-badge">
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown';

const freshnessMeta: Record<Freshness, { tone: Tone; label: string }> = {
  fresh: { tone: 'success', label: 'Fresh' },
  aging: { tone: 'warning', label: 'Aging' },
  stale: { tone: 'danger', label: 'Stale' },
  unknown: { tone: 'neutral', label: 'Unknown' },
};

export function FreshnessStatus({ state, timestamp }: { state: Freshness; timestamp?: string }) {
  const meta = freshnessMeta[state];
  return (
    <StatusBadge tone={meta.tone}>
      {meta.label}
      {timestamp ? ` · ${timestamp}` : ''}
    </StatusBadge>
  );
}

export function RealtimeStatus({
  connected,
  retrying,
}: {
  connected: boolean;
  retrying?: boolean;
}) {
  const Icon = connected ? Wifi : retrying ? RefreshCw : WifiOff;
  return (
    <StatusBadge tone={connected ? 'success' : retrying ? 'warning' : 'danger'}>
      <Icon aria-hidden="true" />
      {connected ? 'Live' : retrying ? 'Menghubungkan ulang' : 'Terputus'}
    </StatusBadge>
  );
}

export function PersonCell({
  name,
  identifier,
  role,
  online,
}: {
  name: string;
  identifier: string;
  role?: string;
  online?: boolean;
}) {
  return (
    <div className="hds-person-cell">
      <Avatar
        name={name}
        size="sm"
        {...(online === undefined
          ? {}
          : { status: online ? ('online' as const) : ('offline' as const) })}
      />
      <span>
        <strong>{name}</strong>
        <small>{role ? `${identifier} · ${role}` : identifier}</small>
      </span>
    </div>
  );
}

export function FilterBar({
  children,
  resultCount,
  onReset,
  updatedAt,
}: {
  children: ReactNode;
  resultCount?: number;
  onReset?: () => void;
  updatedAt?: string;
}) {
  return (
    <div className="hds-filter-bar">
      <div className="hds-filter-bar__controls">{children}</div>
      <div className="hds-filter-bar__meta">
        {resultCount !== undefined && <span>{resultCount} hasil</span>}
        {updatedAt && <LastUpdated value={updatedAt} />}
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset filter
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReadinessCard({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'ready' | 'warning' | 'blocked' | 'not-run';
  detail: string;
}) {
  const meta = {
    ready: { tone: 'success' as Tone, label: 'Ready', icon: CircleCheck },
    warning: { tone: 'warning' as Tone, label: 'Warning', icon: AlertTriangle },
    blocked: { tone: 'danger' as Tone, label: 'Blocked', icon: XCircle },
    'not-run': { tone: 'neutral' as Tone, label: 'Not run', icon: CircleDashed },
  }[state];
  const Icon = meta.icon;
  return (
    <Card className={cn('hds-readiness', `hds-readiness--${state}`)}>
      <div className="hds-readiness__top">
        <strong>{label}</strong>
        <Icon aria-label={meta.label} />
      </div>
      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
      <small>{detail}</small>
    </Card>
  );
}

export function BlockerCard({
  title,
  description,
  count,
  action,
}: {
  title: string;
  description: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <Card className="hds-blocker">
      <span className="hds-blocker__icon">
        <ShieldAlert aria-hidden="true" />
      </span>
      <div>
        <div className="hds-blocker__title">
          <strong>{title}</strong>
          {count !== undefined && <Badge tone="danger">{count}</Badge>}
        </div>
        <p>{description}</p>
        {action}
      </div>
    </Card>
  );
}

export function AssignmentJobCard({
  sequence,
  job,
  process,
  people,
}: {
  sequence: string;
  job: string;
  process: string;
  people: readonly {
    name?: string;
    id?: string;
    state: WorkingAssignmentState;
    reservation?: string;
  }[];
}) {
  return (
    <Card className="hds-job-card">
      <header>
        <span>{sequence}</span>
        <div>
          <strong>{job}</strong>
          <small>{process}</small>
        </div>
      </header>
      <div className="hds-job-card__people">
        {people.map((person, index) => (
          <div
            key={`${person.id ?? 'vacant'}-${index}`}
            className={`is-${person.state.toLowerCase()}`}
          >
            {person.name ? (
              <PersonCell name={person.name} identifier={person.id ?? 'Tidak tersedia'} online />
            ) : (
              <div className="hds-vacancy">
                <UserRound aria-hidden="true" />
                <span>
                  <strong>Vacant</strong>
                  <small>1 posisi terbuka</small>
                </span>
              </div>
            )}
            <AssignmentState state={person.state} />
            {person.reservation && <small>{person.reservation}</small>}
          </div>
        ))}
      </div>
      <footer>
        {people.filter((person) => person.state === 'ASSIGNED').length} / {people.length} assigned
      </footer>
    </Card>
  );
}

export function OneTimeSecretPanel({
  clientId,
  secret,
  onAcknowledged,
  identifierLabel = 'Client ID',
  secretLabel = 'Client secret',
  title = 'Simpan credential sekarang',
  description = 'Secret tidak dapat dipulihkan setelah panel ini ditutup. Rotasi credential bila salinan hilang.',
}: {
  clientId: string;
  secret: string;
  onAcknowledged?: () => void;
  identifierLabel?: string;
  secretLabel?: string;
  title?: string;
  description?: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };
  return (
    <div className="hds-secret">
      <Alert tone="warning" title={title} action={<Badge tone="warning">Ditampilkan sekali</Badge>}>
        {description}
      </Alert>
      <KeyValueGrid
        columns={1}
        items={[
          {
            label: identifierLabel,
            value: (
              <code>
                {clientId}
                <Button variant="ghost" size="sm" onClick={() => void copy(clientId)}>
                  <Copy /> Salin
                </Button>
              </code>
            ),
          },
          {
            label: secretLabel,
            value: (
              <code>
                {secret}
                <Button variant="ghost" size="sm" onClick={() => void copy(secret)}>
                  <Copy /> Salin
                </Button>
              </code>
            ),
          },
        ]}
      />
      <label className="hds-secret__ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.currentTarget.checked)}
        />
        Saya sudah menyimpan credential pada lokasi yang aman.
      </label>
      <Button variant="primary" disabled={!acknowledged} onClick={onAcknowledged}>
        Selesai
      </Button>
    </div>
  );
}

export const OneTimeCredentialPanel = OneTimeSecretPanel;

export function FormErrorSummary({
  errors,
  onSelect,
}: {
  errors: readonly { field: string; message: string }[];
  onSelect?: (field: string) => void;
}) {
  if (errors.length === 0) return null;
  return (
    <div className="hds-error-summary" role="alert" aria-live="assertive">
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>Periksa {errors.length} field berikut</strong>
        <ul>
          {errors.map((error) => (
            <li key={error.field}>
              <button type="button" onClick={() => onSelect?.(error.field)}>
                {error.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LastUpdated({ value, stale }: { value: string; stale?: boolean }) {
  return (
    <span className={cn('hds-last-updated', stale && 'is-stale')}>
      <Radio aria-hidden="true" />
      Terakhir diperbarui {value}
    </span>
  );
}

export function DomainMappingTable() {
  return (
    <div className="hds-domain-matrix">
      <div>
        <strong>4M</strong>
        <FourMIndicator category="MAN" />
        <FourMIndicator category="MACHINE" />
        <FourMIndicator category="MATERIAL" />
        <FourMIndicator category="METHOD" />
      </div>
      <div>
        <strong>Lifecycle</strong>
        <HenkatenStatus status="OPEN" />
        <HenkatenStatus status="APPROVED" />
        <HenkatenStatus status="REJECTED" />
        <HenkatenStatus status="CANCELLED" />
      </div>
      <div>
        <strong>Source</strong>
        <SourceModeBadge mode="HOSTED" />
        <SourceModeBadge mode="EXTERNAL" />
      </div>
      <div>
        <strong>Assignment</strong>
        <AssignmentState state="ASSIGNED" />
        <AssignmentState state="VACANT" />
        <AssignmentState state="RESERVED" />
        <AssignmentState state="CONFLICTED" />
      </div>
    </div>
  );
}

export function DomainFilterDemo() {
  return (
    <FilterBar resultCount={28} updatedAt="10:24 WIB" onReset={() => undefined}>
      <SearchInput label="Cari Henkaten" placeholder="Cari ID atau job…" />
      <Field label="Status">
        <NativeSelect aria-label="Status">
          <option>Semua status</option>
          <option>Open</option>
          <option>Approved</option>
        </NativeSelect>
      </Field>
    </FilterBar>
  );
}

export function NextAction({
  title,
  description,
  actionLabel,
}: {
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <div className="hds-next-action">
      <BadgeCheck aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <Button variant="secondary" size="sm" trailingIcon={<ArrowRight />}>
        {actionLabel}
      </Button>
    </div>
  );
}
