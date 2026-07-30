import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileClock,
  GitPullRequestArrow,
  UserRound,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button, FourMIndicator, HenkatenStatus, Panel } from '@tmmin-henkaten/ui';

import type { supplierApi } from '../app/api';

type SupplierDashboard = Awaited<ReturnType<typeof supplierApi.dashboard>>;
type AgingItem = SupplierDashboard['approvalAging'][number];
type ActivityItem = SupplierDashboard['recentActivity'][number];

const agingMeta: Record<
  AgingItem['bucket'],
  { label: string; className: string; description: string }
> = {
  UNDER_4_HOURS: {
    label: '0–4 jam',
    className: 'is-fresh',
    description: 'Masih dalam empat jam pertama',
  },
  FOUR_TO_EIGHT_HOURS: {
    label: '4–8 jam',
    className: 'is-watch',
    description: 'Perlu mulai dipantau',
  },
  EIGHT_TO_24_HOURS: {
    label: '8–24 jam',
    className: 'is-aging',
    description: 'Mendekati satu hari',
  },
  OVER_24_HOURS: {
    label: '>24 jam',
    className: 'is-critical',
    description: 'Melewati satu hari',
  },
};

export function ApprovalAgingDistribution({
  items,
  showApprovalLink,
}: {
  items: SupplierDashboard['approvalAging'];
  showApprovalLink: boolean;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <Panel
      title="Approval aging"
      description="Usia route approval yang masih pending."
      action={
        showApprovalLink ? (
          <Link className="overview-widget-link" to="/approvals">
            Buka antrean
          </Link>
        ) : undefined
      }
      className="overview-widget overview-widget--aging"
    >
      {total ? (
        <>
          <div className="aging-distribution" aria-label={`${total} route approval masih pending`}>
            {items
              .filter((item) => item.count > 0)
              .map((item) => (
                <span
                  key={item.bucket}
                  className={agingMeta[item.bucket].className}
                  style={{ '--aging-weight': item.count } as CSSProperties}
                  title={`${agingMeta[item.bucket].label}: ${item.count}`}
                />
              ))}
          </div>
          <div className="aging-breakdown">
            {items.map((item) => {
              const meta = agingMeta[item.bucket];
              const percentage = Math.round((item.count / total) * 100);
              return (
                <div key={item.bucket} title={meta.description}>
                  <span>{meta.label}</span>
                  <strong>{item.count}</strong>
                  <small>{percentage}%</small>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <WidgetEmpty
          icon={<CheckCircle2 />}
          title="Tidak ada approval tertunda"
          description="Semua route pada scope saat ini sudah diputuskan."
        />
      )}
    </Panel>
  );
}

export function RankedDistribution({
  title,
  description,
  items,
  emptyLabel,
  layout,
}: {
  title: string;
  description: string;
  items: SupplierDashboard['byLine'] | SupplierDashboard['byPart'];
  emptyLabel: string;
  layout: 'line' | 'part';
}) {
  const visibleItems = items.slice(0, 6);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const maximum = Math.max(...visibleItems.map((item) => item.count), 0);
  return (
    <Panel
      title={title}
      description={description}
      className={`overview-widget overview-widget--distribution overview-widget--${layout}`}
    >
      {visibleItems.length ? (
        <ol className="ranked-distribution">
          {visibleItems.map((item, index) => (
            <li key={item.label}>
              <span className="ranked-distribution__rank">{index + 1}</span>
              <span className="ranked-distribution__content">
                <span>
                  <strong title={item.label}>{item.label}</strong>
                  <small>{total ? Math.round((item.count / total) * 100) : 0}% dari total</small>
                </span>
                <span className="ranked-distribution__track" aria-hidden="true">
                  <i style={{ width: `${maximum ? (item.count / maximum) * 100 : 0}%` }} />
                </span>
              </span>
              <strong className="ranked-distribution__value">{item.count}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <WidgetEmpty
          icon={<CircleDot />}
          title={emptyLabel}
          description="Ubah filter atau rentang tanggal untuk melihat distribusi."
        />
      )}
    </Panel>
  );
}

export function RecentActivityFeed({
  items,
  expanded,
  onExpandedChange,
  timezone,
  canReadHenkaten,
}: {
  items: SupplierDashboard['recentActivity'];
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  timezone: string;
  canReadHenkaten: boolean;
}) {
  const visibleItems = expanded ? items : items.slice(0, 5);
  const remaining = Math.max(items.length - 5, 0);
  return (
    <Panel
      title="Aktivitas terbaru"
      description="Perubahan operasional terbaru pada scope Anda."
      action={
        items.length ? (
          <span className="overview-activity-count">{items.length} event terbaru</span>
        ) : undefined
      }
      className="overview-widget overview-widget--activity"
    >
      {visibleItems.length ? (
        <ol className="overview-activity-list" id="overview-recent-activity">
          {visibleItems.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              timezone={timezone}
              canReadHenkaten={canReadHenkaten}
            />
          ))}
        </ol>
      ) : (
        <WidgetEmpty
          icon={<FileClock />}
          title="Belum ada aktivitas"
          description="Aktivitas akan muncul setelah operasi pertama tercatat."
        />
      )}
      {items.length > 5 && (
        <div className="overview-activity-footer">
          <Button
            variant="secondary"
            size="sm"
            aria-controls="overview-recent-activity"
            aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan lebih banyak (${remaining})`}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function ActivityRow({
  item,
  timezone,
  canReadHenkaten,
}: {
  item: ActivityItem;
  timezone: string;
  canReadHenkaten: boolean;
}) {
  const henkaten = item.henkaten;
  const Icon = activityIcon(item.action);
  return (
    <li>
      <span className={`overview-activity-icon ${activityTone(item.action)}`}>
        <Icon aria-hidden="true" />
      </span>
      <div className="overview-activity-main">
        <div className="overview-activity-heading">
          <strong>{activityLabel(item.action)}</strong>
          {henkaten && (
            <>
              <FourMIndicator category={henkaten.category} compact />
              <HenkatenStatus status={henkaten.status} />
            </>
          )}
        </div>
        {henkaten ? (
          <>
            {canReadHenkaten ? (
              <Link className="overview-activity-identifier" to={`/henkatens/${henkaten.id}`}>
                {henkaten.identifier}
              </Link>
            ) : (
              <span className="overview-activity-identifier">{henkaten.identifier}</span>
            )}
            <div className="overview-activity-facts">
              <span>
                <strong>{henkaten.line.code}</strong>
                {` · ${henkaten.line.name} / ${henkaten.jobName}`}
              </span>
              <span>
                <strong>{henkaten.part.number}</strong>
                {` · ${henkaten.part.name}`}
              </span>
            </div>
          </>
        ) : (
          <span className="overview-activity-resource">
            {resourceLabel(item.resourceType)}
            {item.resourceId ? ` · ${shortResourceId(item.resourceId)}` : ''}
          </span>
        )}
      </div>
      <div className="overview-activity-meta">
        <span>
          <UserRound aria-hidden="true" />
          {actorLabel(item)}
        </span>
        <time dateTime={item.occurredAt}>{formatActivityTime(item.occurredAt, timezone)}</time>
      </div>
    </li>
  );
}

function WidgetEmpty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="overview-widget-empty" role="status">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </div>
  );
}

function activityIcon(action: string) {
  if (action.includes('APPROV')) return CheckCircle2;
  if (action.includes('ISSUE') || action.includes('CONFLICT')) return AlertTriangle;
  if (action.includes('REROUT')) return GitPullRequestArrow;
  return FileClock;
}

function activityTone(action: string) {
  if (action.includes('APPROVED')) return 'is-success';
  if (action.includes('REJECT') || action.includes('CONFLICT')) return 'is-danger';
  if (action.includes('ISSUE') || action.includes('OVERRIDE')) return 'is-warning';
  return 'is-info';
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    NOTIFICATION_GENERATED: 'Notifikasi dibuat',
    NOTIFICATION_READ: 'Notifikasi ditandai sudah dibaca',
    NOTIFICATION_UNREAD: 'Notifikasi ditandai belum dibaca',
    HENKATEN_SUBMITTED: 'Henkaten dibuat',
    HENKATEN_APPROVAL_DECIDED: 'Keputusan approval dicatat',
    HENKATEN_APPROVAL_CONFLICT: 'Konflik approval terdeteksi',
    HENKATEN_APPROVAL_RECORDED: 'Approval Henkaten dicatat',
    HENKATEN_OPENED: 'Henkaten dibuka',
    HENKATEN_APPROVED: 'Henkaten disetujui',
    HENKATEN_REJECTED: 'Henkaten ditolak',
    HENKATEN_CANCELLED: 'Henkaten dibatalkan',
    HENKATEN_WITHDRAWN: 'Henkaten ditarik',
    HENKATEN_SUPERVISOR_REROUTED: 'Penanggung jawab Supervisor dialihkan',
    WARNING_OPENED: 'Peringatan dibuka',
    SHIFT_PREFLIGHT_COMPLETED: 'Pemeriksaan shift selesai',
    SHIFT_STARTED: 'Shift dimulai',
    SHIFT_START_BLOCKED: 'Shift gagal dimulai',
    ASSIGNMENT_ISSUE_OPENED: 'Assignment issue dibuka',
    ASSIGNMENT_ISSUE_RESOLVED: 'Assignment issue diselesaikan',
    SHIFT_STARTED_WITH_OVERRIDE: 'Shift dimulai dengan override',
    SHIFT_ENDED: 'Shift diakhiri',
  };
  return labels[action] ?? humanize(action);
}

function resourceLabel(resourceType: string) {
  return humanize(resourceType.replace(/([a-z])([A-Z])/g, '$1_$2'));
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function actorLabel(item: ActivityItem) {
  if (item.actor.displayName) return item.actor.displayName;
  if (item.actor.kind === 'EXTERNAL_CLIENT') return 'Klien eksternal';
  return 'Sistem';
}

function shortResourceId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatActivityTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}
