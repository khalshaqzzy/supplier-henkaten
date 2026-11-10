import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Clock3,
  Factory,
  HardHat,
  KeyRound,
  MapPin,
  ShieldAlert,
  UserCog,
  UserRound,
  UserRoundCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@tmmin-henkaten/ui';

import {
  reasonMeta,
  type BlockerAreaGroup,
  type BlockerIssue,
  type BlockerItem,
  type SetupAction,
} from './setupBlockers';

export const INITIAL_VISIBLE_ITEMS = 6;

const issueIcons: Record<string, ReactNode> = {
  ACTIVE_SHIFT_TEMPLATE_MISSING: <Clock3 />,
  ACTIVE_MEMBER_MISSING: <Users />,
  HOSTED_ADMIN_MISSING: <ShieldAlert />,
  OPERATIONAL_ACCOUNT_MISSING: <KeyRound />,
  ACTIVE_LINE_MISSING: <Factory />,
  ACTIVE_JOB_MISSING: <Wrench />,
  LINE_SHIFT_CONFIGURATION_PENDING: <Factory />,
  LINE_SHIFT_MISSING: <CalendarClock />,
  LINE_SHIFT_SUPERVISOR_MISSING: <UserCog />,
  LINE_SHIFT_LEADER_MISSING: <UserRoundCheck />,
  LINE_SHIFT_MP_MISSING: <HardHat />,
};

export function areaSectionId(area: string) {
  return `setup-area-${area.toLowerCase().replaceAll('_', '-')}`;
}

export function SetupBlockerPanel({
  groups,
  total,
  openKeys,
  onOpenKeysChange,
}: {
  groups: readonly BlockerAreaGroup[];
  total: number;
  openKeys: ReadonlySet<string>;
  onOpenKeysChange: (keys: Set<string>) => void;
}) {
  const allKeys = groups.flatMap((group) => group.issues.map((issue) => issue.key));
  const allOpen = allKeys.length > 0 && allKeys.every((key) => openKeys.has(key));
  const toggle = (key: string) => {
    const next = new Set(openKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onOpenKeysChange(next);
  };

  return (
    <section className="setup-blockers" aria-labelledby="setup-blockers-title">
      <header className="setup-blockers__header">
        <div>
          <h2 id="setup-blockers-title">Perlu diselesaikan</h2>
          <p>
            {total} blocker · {groups.length} area
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          onClick={() => onOpenKeysChange(allOpen ? new Set() : new Set(allKeys))}
        >
          <span className="setup-blockers__toggle-label">
            {allOpen ? 'Tutup semua' : 'Buka semua'}
          </span>
        </Button>
      </header>
      <div className="setup-blockers__body">
        {groups.map((group) => (
          <section
            key={group.area}
            id={areaSectionId(group.area)}
            className="setup-blocker-area"
            aria-labelledby={`${areaSectionId(group.area)}-title`}
            tabIndex={-1}
          >
            <header className="setup-blocker-area__head">
              <span className="setup-blocker-area__step" aria-hidden="true">
                {group.step}
              </span>
              <h3 id={`${areaSectionId(group.area)}-title`}>{group.label}</h3>
              <span className="setup-count-chip">{group.count}</span>
              <Link className="setup-blocker-area__link" to={group.to}>
                Buka {group.label}
                <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            <ul className="setup-issue-list">
              {group.issues.map((issue) => (
                <IssueRow
                  key={issue.key}
                  issue={issue}
                  open={openKeys.has(issue.key)}
                  onToggle={() => toggle(issue.key)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  open,
  onToggle,
}: {
  issue: BlockerIssue;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const itemTotal = issue.contexts.reduce((total, context) => total + context.items.length, 0);
  let remaining = expanded ? Number.POSITIVE_INFINITY : INITIAL_VISIBLE_ITEMS;
  const contexts = issue.contexts.flatMap((context) => {
    if (remaining <= 0) return [];
    const items = context.items.slice(0, remaining);
    remaining -= items.length;
    return [{ ...context, items, hidden: context.items.length - items.length }];
  });
  const hiddenItems = itemTotal - contexts.reduce((total, c) => total + c.items.length, 0);

  return (
    <li className={`setup-issue${open ? ' is-open' : ''}`}>
      <h4 className="setup-issue__heading">
        <button
          type="button"
          id={`${id}-trigger`}
          className="setup-issue__trigger"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={onToggle}
        >
          <span className="setup-issue__icon" aria-hidden="true">
            {issueIcons[issue.code] ?? <CircleAlert />}
          </span>
          <span className="setup-issue__text">
            <strong>{issue.title}</strong>
            <small>{issue.summary}</small>
          </span>
          {issue.count > 1 && (
            <span className="setup-count-chip is-muted" aria-label={`${issue.count} blocker`}>
              {issue.count}
            </span>
          )}
          <ChevronDown className="setup-issue__chevron" aria-hidden="true" />
        </button>
      </h4>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        className="setup-issue__panel"
        data-state={open ? 'open' : 'closed'}
        inert={!open}
      >
        <div className="setup-issue__inner">
          {issue.note && <p className="setup-issue__note">{issue.note}</p>}
          {contexts.map((context) => (
            <div className="setup-issue__context" key={context.key}>
              {context.title && (
                <div className="setup-context-head">
                  <MapPin aria-hidden="true" />
                  <strong>{context.title}</strong>
                  {context.subtitle && <span>{context.subtitle}</span>}
                </div>
              )}
              <ul className="setup-entity-list">
                {context.items.map((item) => (
                  <EntityRow key={item.key} item={item} />
                ))}
              </ul>
            </div>
          ))}
          {(hiddenItems > 0 || expanded) && itemTotal > INITIAL_VISIBLE_ITEMS && (
            <button
              type="button"
              className="setup-issue__more"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan ${hiddenItems} lainnya`}
              <ChevronDown aria-hidden="true" />
            </button>
          )}
          {(issue.actions.length > 0 || issue.hiddenCandidates) && (
            <div className="setup-issue__actions">
              {issue.hiddenCandidates && <ActionLink action={issue.hiddenCandidates.action} />}
              {issue.actions.map((action) => (
                <ActionLink key={action.to} action={action} />
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function EntityRow({ item }: { item: BlockerItem }) {
  return (
    <li className="setup-entity">
      <span className="setup-entity__main">
        <strong>{item.title}</strong>
        {item.subtitle && <small>{item.subtitle}</small>}
      </span>
      {(item.reason || item.person) && (
        <span className="setup-entity__state">
          {item.reason && (
            <span className={`setup-reason is-${reasonMeta[item.reason].tone}`}>
              {reasonMeta[item.reason].label}
            </span>
          )}
          {item.person && (
            <span className="setup-entity__person">
              <UserRound aria-hidden="true" />
              {item.person}
            </span>
          )}
        </span>
      )}
      <span className="setup-entity__actions">
        {item.actions.map((action) => (
          <ActionLink key={action.to} action={action} />
        ))}
      </span>
    </li>
  );
}

function ActionLink({ action }: { action: SetupAction }) {
  return (
    <Link
      className={`setup-action is-${action.emphasis}`}
      to={action.to}
      aria-label={action.ariaLabel}
    >
      {action.label}
      {action.emphasis === 'primary' && <ArrowRight aria-hidden="true" />}
    </Link>
  );
}
