import type {
  SupplierSetupArea,
  SupplierSetupBlocker,
  SupplierSetupBlockerCandidate,
  SupplierSetupBlockerReason,
} from '@tmmin-henkaten/contracts';

export const setupAreaMeta: Record<SupplierSetupArea, { label: string; to: string }> = {
  SHIFT_TEMPLATES: { label: 'Shift Template', to: '/master-data/shifts' },
  MEMBERS_ACCOUNTS: { label: 'Member & akun', to: '/master-data/members' },
  LINES_JOBS: { label: 'Line & job', to: '/master-data/lines' },
  PARTS: { label: 'Part', to: '/master-data/parts' },
  CHECKLISTS: { label: 'Checklist 4M', to: '/master-data/checklists' },
  DEFAULT_ASSIGNMENTS: { label: 'Line Setup', to: '/master-data/line-setup' },
};

export const setupAreaOrder = Object.keys(setupAreaMeta) as SupplierSetupArea[];

export type ReasonTone = 'warning' | 'danger' | 'neutral';

export const reasonMeta: Record<SupplierSetupBlockerReason, { label: string; tone: ReasonTone }> = {
  NOT_CONFIGURED: { label: 'Belum dibuat', tone: 'warning' },
  ONLY_INACTIVE: { label: 'Nonaktif', tone: 'neutral' },
  UNASSIGNED: { label: 'Belum ditetapkan', tone: 'warning' },
  MEMBER_ARCHIVED: { label: 'Member diarsipkan', tone: 'danger' },
  ACCOUNT_INACTIVE: { label: 'Akun belum aktif', tone: 'warning' },
  COUNT_MISMATCH: { label: 'Tidak sesuai', tone: 'danger' },
};

export type SetupAction = {
  label: string;
  /** Accessible name; distinguishes repeated short labels such as “Tetapkan”. */
  ariaLabel: string;
  to: string;
  emphasis: 'primary' | 'secondary';
};

export type BlockerItem = {
  key: string;
  title: string;
  subtitle?: string;
  reason?: SupplierSetupBlockerReason;
  /** Person currently holding the position, when the gap is caused by their state. */
  person?: string;
  actions: SetupAction[];
};

export type BlockerContext = {
  key: string;
  title?: string;
  subtitle?: string;
  items: BlockerItem[];
};

export type BlockerIssue = {
  key: string;
  area: SupplierSetupArea;
  code: string;
  title: string;
  summary: string;
  /** Number of readiness blockers represented by this issue. */
  count: number;
  contexts: BlockerContext[];
  /** Issue-wide corrective actions, shown above or instead of individual items. */
  actions: SetupAction[];
  note?: string;
  /** Candidates that exist but are not listed individually. */
  hiddenCandidates?: { count: number; action: SetupAction };
};

export type BlockerAreaGroup = {
  area: SupplierSetupArea;
  label: string;
  to: string;
  step: number;
  count: number;
  issues: BlockerIssue[];
};

const issueTitles: Record<string, string> = {
  ACTIVE_SHIFT_TEMPLATE_MISSING: 'Belum ada Shift Template aktif',
  ACTIVE_MEMBER_MISSING: 'Belum ada member aktif',
  HOSTED_ADMIN_MISSING: 'Supplier Admin aktif harus tepat satu',
  OPERATIONAL_ACCOUNT_MISSING: 'Belum ada akun operasional aktif',
  ACTIVE_LINE_MISSING: 'Belum ada line aktif',
  ACTIVE_JOB_MISSING: 'Belum ada job aktif',
  LINE_SHIFT_CONFIGURATION_PENDING: 'Line Setup menunggu line aktif',
  LINE_SHIFT_MISSING: 'Line belum memiliki shift aktif',
  LINE_SHIFT_SUPERVISOR_MISSING: 'Supervisor belum lengkap',
  LINE_SHIFT_LEADER_MISSING: 'Line Leader belum lengkap',
  LINE_SHIFT_MP_MISSING: 'MP belum lengkap',
};

export function lineLabel(line: { code: string; name: string }) {
  return `${line.code} · ${line.name}`;
}

export function shiftLabel(shift: {
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}) {
  return `${shift.name} · ${shift.startTime}–${shift.endTime}${shift.crossesMidnight ? ' +1' : ''}`;
}

type LineSetupFocus = 'supervisor' | 'line-leader' | 'add-shift' | 'shift-status' | `job:${string}`;

export function lineSetupHref(input: {
  lineId?: string | undefined;
  lineShiftId?: string | undefined;
  focus: LineSetupFocus;
}) {
  const params = new URLSearchParams();
  if (input.lineId) params.set('lineId', input.lineId);
  if (input.lineShiftId) params.set('lineShiftId', input.lineShiftId);
  params.set('focus', input.focus);
  return `/master-data/line-setup?${params.toString()}`;
}

type DetailFocus = 'status' | 'account' | 'jobs';

function detailHref(kind: 'members' | 'lines' | 'shifts', id: string, focus: DetailFocus) {
  return `/master-data/${kind}/${id}?focus=${focus}`;
}

const action = (
  label: string,
  to: string,
  context: string,
  emphasis: SetupAction['emphasis'] = 'primary',
): SetupAction => ({ label, to, emphasis, ariaLabel: context ? `${label}: ${context}` : label });

function positionLabel(code: string) {
  return code === 'LINE_SHIFT_SUPERVISOR_MISSING' ? 'Supervisor' : 'Line Leader';
}

/** Corrective actions for one Line–Shift position, ordered by the most direct fix. */
function positionActions(blocker: SupplierSetupBlocker, context: string): SetupAction[] {
  const isMp = blocker.code === 'LINE_SHIFT_MP_MISSING';
  const focus: LineSetupFocus = isMp
    ? `job:${blocker.job?.id ?? ''}`
    : blocker.code === 'LINE_SHIFT_SUPERVISOR_MISSING'
      ? 'supervisor'
      : 'line-leader';
  const assign = lineSetupHref({
    lineId: blocker.line?.id,
    lineShiftId: blocker.shift?.lineShiftId,
    focus,
  });
  const role = isMp ? 'MP' : positionLabel(blocker.code);
  const member = blocker.member;
  if (blocker.reason === 'ACCOUNT_INACTIVE' && member) {
    return [
      action('Aktifkan akun', detailHref('members', member.id, 'account'), member.fullName),
      action(`Ganti ${role}`, assign, context, 'secondary'),
    ];
  }
  if (blocker.reason === 'MEMBER_ARCHIVED' && member) {
    return [
      action(`Ganti ${role}`, assign, context),
      action(
        'Lihat member',
        detailHref('members', member.id, 'status'),
        member.fullName,
        'secondary',
      ),
    ];
  }
  return [action(`Tetapkan ${role}`, assign, context)];
}

function candidateAction(
  code: string,
  candidate: SupplierSetupBlockerCandidate,
  reason: SupplierSetupBlockerReason | undefined,
): SetupAction {
  if (candidate.kind === 'SHIFT_TEMPLATE') {
    return action('Aktifkan', detailHref('shifts', candidate.id, 'status'), candidate.label);
  }
  if (candidate.kind === 'LINE') {
    return code === 'ACTIVE_JOB_MISSING'
      ? action('Tambah job', detailHref('lines', candidate.id, 'jobs'), candidate.label)
      : action('Aktifkan', detailHref('lines', candidate.id, 'status'), candidate.label);
  }
  return reason === 'ACCOUNT_INACTIVE'
    ? action('Aktifkan akun', detailHref('members', candidate.id, 'account'), candidate.label)
    : action('Pulihkan', detailHref('members', candidate.id, 'status'), candidate.label);
}

const createActions: Record<string, SetupAction> = {
  ACTIVE_SHIFT_TEMPLATE_MISSING: action('Buat Shift Template', '/master-data/shifts/new', ''),
  ACTIVE_MEMBER_MISSING: action('Tambah member', '/master-data/members/new', ''),
  OPERATIONAL_ACCOUNT_MISSING: action('Tambah member', '/master-data/members/new', ''),
  ACTIVE_LINE_MISSING: action('Tambah line', '/master-data/lines/new', ''),
  ACTIVE_JOB_MISSING: action('Tambah line', '/master-data/lines/new', ''),
  LINE_SHIFT_CONFIGURATION_PENDING: action('Tambah line', '/master-data/lines/new', ''),
};

const candidateListHref: Record<string, string> = {
  ACTIVE_SHIFT_TEMPLATE_MISSING: '/master-data/shifts?active=INACTIVE',
  ACTIVE_MEMBER_MISSING: '/master-data/members?active=INACTIVE',
  OPERATIONAL_ACCOUNT_MISSING: '/master-data/members',
  ACTIVE_LINE_MISSING: '/master-data/lines?active=INACTIVE',
  ACTIVE_JOB_MISSING: '/master-data/lines',
};

const candidateHeading: Record<string, string> = {
  ACTIVE_SHIFT_TEMPLATE_MISSING: 'Shift Template nonaktif',
  ACTIVE_MEMBER_MISSING: 'Member di arsip',
  OPERATIONAL_ACCOUNT_MISSING: 'Member dengan akun belum aktif',
  ACTIVE_LINE_MISSING: 'Line nonaktif',
  ACTIVE_JOB_MISSING: 'Line tanpa job aktif',
};

function aggregateIssue(blocker: SupplierSetupBlocker, key: string): BlockerIssue {
  const candidates = blocker.candidates ?? [];
  const total = blocker.candidateTotal ?? candidates.length;
  const create = createActions[blocker.code];
  const items: BlockerItem[] = candidates.map((candidate) => ({
    key: candidate.id,
    title: candidate.label,
    ...(candidate.detail ? { subtitle: candidate.detail } : {}),
    ...(blocker.reason && blocker.code !== 'ACTIVE_JOB_MISSING' ? { reason: blocker.reason } : {}),
    actions: [candidateAction(blocker.code, candidate, blocker.reason)],
  }));
  const hidden = total - candidates.length;
  const listHref = candidateListHref[blocker.code];
  const summary =
    blocker.code === 'HOSTED_ADMIN_MISSING'
      ? 'Hubungi TMMIN Admin'
      : !total
        ? 'Belum ada data'
        : blocker.code === 'ACTIVE_JOB_MISSING'
          ? `${total} line tanpa job`
          : blocker.reason === 'ACCOUNT_INACTIVE'
            ? `${total} akun dapat diaktifkan`
            : `${total} data dapat diaktifkan`;
  return {
    key,
    area: blocker.area,
    code: blocker.code,
    title: issueTitles[blocker.code] ?? blocker.detail,
    summary,
    count: 1,
    contexts: items.length
      ? [{ key: 'candidates', title: candidateHeading[blocker.code] ?? 'Data terkait', items }]
      : [],
    actions: create ? [{ ...create, emphasis: items.length ? 'secondary' : 'primary' }] : [],
    ...(blocker.code === 'HOSTED_ADMIN_MISSING'
      ? { note: 'Perubahan Supplier Admin dilakukan oleh TMMIN Admin.' }
      : !items.length && !create
        ? { note: blocker.detail }
        : {}),
    ...(hidden > 0 && listHref
      ? {
          hiddenCandidates: {
            count: hidden,
            action: action(`Lihat ${hidden} lainnya`, listHref, '', 'secondary'),
          },
        }
      : {}),
  };
}

function lineShiftContext(blocker: SupplierSetupBlocker) {
  return {
    key: blocker.shift?.lineShiftId ?? blocker.line?.id ?? blocker.resourceId ?? blocker.code,
    title: blocker.line ? lineLabel(blocker.line) : blocker.detail,
    ...(blocker.shift ? { subtitle: shiftLabel(blocker.shift) } : {}),
  };
}

function entityIssue(code: string, area: SupplierSetupArea, blockers: SupplierSetupBlocker[]) {
  const key = `${area}:${code}`;
  const contexts = new Map<string, BlockerContext>();
  const place = (
    context: { key: string; title?: string; subtitle?: string },
    item: BlockerItem,
  ) => {
    const existing = contexts.get(context.key);
    if (existing) existing.items.push(item);
    else contexts.set(context.key, { ...context, items: [item] });
  };

  for (const [index, blocker] of blockers.entries()) {
    const where = lineShiftContext(blocker);
    const contextLabel = [where.title, blocker.shift?.name].filter(Boolean).join(' · ');
    if (code === 'LINE_SHIFT_MISSING') {
      const inactive = blocker.reason === 'ONLY_INACTIVE' && blocker.shift;
      place(
        { key: 'lines' },
        {
          key: blocker.line?.id ?? String(index),
          title: where.title,
          ...(inactive ? { subtitle: `${shiftLabel(blocker.shift!)} nonaktif` } : {}),
          ...(blocker.reason ? { reason: blocker.reason } : {}),
          actions: [
            inactive
              ? action(
                  'Aktifkan shift',
                  lineSetupHref({
                    lineId: blocker.line?.id,
                    lineShiftId: blocker.shift!.lineShiftId,
                    focus: 'shift-status',
                  }),
                  where.title,
                )
              : action(
                  'Tambah shift',
                  lineSetupHref({ lineId: blocker.line?.id, focus: 'add-shift' }),
                  where.title,
                ),
          ],
        },
      );
      continue;
    }
    if (code === 'LINE_SHIFT_MP_MISSING') {
      const job = blocker.job;
      place(where, {
        key: job?.id ?? String(index),
        title: job ? job.name : blocker.detail,
        ...(job ? { subtitle: `Job ${String(job.displayOrder).padStart(2, '0')}` } : {}),
        ...(blocker.reason ? { reason: blocker.reason } : {}),
        ...(blocker.member ? { person: blocker.member.fullName } : {}),
        actions: positionActions(blocker, [contextLabel, job?.name].filter(Boolean).join(' · ')),
      });
      continue;
    }
    place(
      { key: 'positions' },
      {
        key: where.key,
        title: where.title,
        ...(where.subtitle ? { subtitle: where.subtitle } : {}),
        ...(blocker.reason ? { reason: blocker.reason } : {}),
        ...(blocker.member ? { person: blocker.member.fullName } : {}),
        actions: positionActions(blocker, contextLabel),
      },
    );
  }

  const lineShiftCount = new Set(blockers.map((b) => b.shift?.lineShiftId ?? b.resourceId)).size;
  const summary =
    code === 'LINE_SHIFT_MISSING'
      ? `${blockers.length} line`
      : code === 'LINE_SHIFT_MP_MISSING'
        ? `${blockers.length} job · ${lineShiftCount} line-shift`
        : `${blockers.length} line-shift`;
  return {
    key,
    area,
    code,
    title: issueTitles[code] ?? blockers[0]!.detail,
    summary,
    count: blockers.length,
    contexts: [...contexts.values()],
    actions: [],
  } satisfies BlockerIssue;
}

const entityCodes = new Set([
  'LINE_SHIFT_MISSING',
  'LINE_SHIFT_SUPERVISOR_MISSING',
  'LINE_SHIFT_LEADER_MISSING',
  'LINE_SHIFT_MP_MISSING',
]);

/**
 * Groups readiness blockers by setup area and blocker type. Entity blockers are merged into one
 * issue per type and arranged by Line–Shift; aggregate blockers keep their own issue.
 */
export function groupSetupBlockers(blockers: readonly SupplierSetupBlocker[]): BlockerAreaGroup[] {
  return setupAreaOrder.flatMap((area, index) => {
    const inArea = blockers.filter((blocker) => blocker.area === area);
    if (!inArea.length) return [];
    // Preserve server order: an entity type takes the position of its first blocker.
    const slots: Array<{ code: string } | { issue: BlockerIssue }> = [];
    const byCode = new Map<string, SupplierSetupBlocker[]>();
    for (const blocker of inArea) {
      if (entityCodes.has(blocker.code)) {
        const list = byCode.get(blocker.code);
        if (list) list.push(blocker);
        else {
          byCode.set(blocker.code, [blocker]);
          slots.push({ code: blocker.code });
        }
        continue;
      }
      const duplicate = slots.filter(
        (slot) => 'issue' in slot && slot.issue.code === blocker.code,
      ).length;
      slots.push({
        issue: aggregateIssue(
          blocker,
          `${area}:${blocker.code}${duplicate ? `:${duplicate}` : ''}`,
        ),
      });
    }
    const resolved = slots.map((slot) =>
      'issue' in slot ? slot.issue : entityIssue(slot.code, area, byCode.get(slot.code)!),
    );
    return [
      {
        area,
        label: setupAreaMeta[area].label,
        to: setupAreaMeta[area].to,
        step: index + 1,
        count: inArea.length,
        issues: resolved,
      },
    ];
  });
}
