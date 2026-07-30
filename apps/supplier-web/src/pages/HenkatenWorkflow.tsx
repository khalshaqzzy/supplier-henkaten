import {
  ArrowRight,
  Check,
  CircleAlert,
  Cog,
  Package,
  RefreshCw,
  UserRound,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';

import type { HenkatenCategory, WorkingAssignment } from '@tmmin-henkaten/contracts';

type ReplacementMember = {
  id: string;
  fullName: string;
  registrationNumber: string;
  reserved: boolean;
  currentAssignment: {
    lineName: string;
    jobName: string;
  } | null;
};

type ApprovalDecision = {
  actorName: string;
  actorRole: 'SUPERVISOR' | 'QC';
  comment: string | null;
  decidedAt: string;
};

type ApprovalRoute = {
  route: 'SUPERVISOR' | 'QC';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED';
  currentResponsibleName: string | null;
  decision: ApprovalDecision | null;
};

const CATEGORY_META = {
  MAN: { label: 'Man', icon: UserRound },
  MACHINE: { label: 'Machine', icon: Cog },
  MATERIAL: { label: 'Material', icon: Package },
  METHOD: { label: 'Method', icon: Wrench },
} satisfies Record<HenkatenCategory, { label: string; icon: typeof UserRound }>;

export function HenkatenCategoryPicker({
  value,
  onChange,
}: {
  value: HenkatenCategory;
  onChange: (value: HenkatenCategory) => void;
}) {
  return (
    <div className="category-picker" role="radiogroup" aria-label="Kategori Henkaten">
      {(Object.keys(CATEGORY_META) as HenkatenCategory[]).map((category) => {
        const meta = CATEGORY_META[category];
        const Icon = meta.icon;
        const selected = value === category;
        return (
          <button
            key={category}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`is-${category.toLowerCase()}${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(category)}
          >
            <span className="category-picker__icon">
              <Icon aria-hidden="true" />
            </span>
            <span>
              <strong>{meta.label}</strong>
              <small>
                {category === 'MAN'
                  ? 'Perubahan personel'
                  : `Perubahan ${meta.label.toLowerCase()}`}
              </small>
            </span>
            <span className="category-picker__check" aria-hidden="true">
              {selected ? <Check /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SelectedPart({
  part,
  onClear,
}: {
  part: { partNumber: string; partName: string } | undefined;
  onClear: () => void;
}) {
  if (!part) return null;
  return (
    <div className="selected-part" role="status">
      <span className="selected-part__icon">
        <Check aria-hidden="true" />
      </span>
      <span>
        <strong>{part.partNumber}</strong>
        <small>{part.partName}</small>
      </span>
      <button type="button" aria-label={`Hapus pilihan part ${part.partNumber}`} onClick={onClear}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export function ManMovementPreview({
  target,
  replacement,
  targetLine,
}: {
  target: WorkingAssignment | undefined;
  replacement: ReplacementMember | undefined;
  targetLine: string | undefined;
}) {
  return (
    <div className="movement-preview" aria-label="Preview pergerakan Man">
      <div className={`movement-preview__node${target ? ' is-ready' : ''}`}>
        <span>Assignment target</span>
        <strong>{target?.jobName ?? 'Belum dipilih'}</strong>
        <small>{targetLine ?? 'Line belum tersedia'}</small>
        <dl>
          <div>
            <dt>MP saat ini</dt>
            <dd>{target?.mpName ?? (target ? 'VACANT' : '-')}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{target ? humanize(target.state) : '-'}</dd>
          </div>
        </dl>
      </div>
      <span className="movement-preview__direction" aria-hidden="true">
        <ArrowRight />
      </span>
      <div
        className={`movement-preview__node${replacement ? ' is-ready' : ''}${
          replacement?.reserved ? ' is-blocked' : ''
        }`}
      >
        <span>Replacement MP</span>
        <strong>{replacement?.fullName ?? 'Belum dipilih'}</strong>
        <small>{replacement?.registrationNumber ?? 'Pilih kandidat yang tersedia'}</small>
        <dl>
          <div>
            <dt>Assignment sumber</dt>
            <dd>
              {replacement?.currentAssignment
                ? `${replacement.currentAssignment.lineName} / ${replacement.currentAssignment.jobName}`
                : replacement
                  ? 'Tidak sedang assigned'
                  : '-'}
            </dd>
          </div>
          <div>
            <dt>Ketersediaan</dt>
            <dd>{replacement ? (replacement.reserved ? 'Reserved' : 'Tersedia') : '-'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function ChecklistResponseList({
  items,
  answers,
  onChange,
}: {
  items: Array<{ id: string; label: string }>;
  answers: Record<string, 'YES' | 'NO'>;
  onChange: (itemId: string, answer: 'YES' | 'NO') => void;
}) {
  return (
    <ol className="checklist-answers">
      {items.map((item, index) => {
        const answer = answers[item.id];
        return (
          <li
            key={item.id}
            className={answer === 'YES' ? 'is-yes' : answer === 'NO' ? 'is-no' : 'is-unanswered'}
          >
            <span className="checklist-answers__number">{index + 1}</span>
            <span className="checklist-answers__question">
              <strong>{item.label}</strong>
              <small>
                {answer === 'YES'
                  ? 'Memenuhi persyaratan'
                  : answer === 'NO'
                    ? 'Jawaban No memblokir submission'
                    : 'Belum dijawab'}
              </small>
            </span>
            <span
              className="checklist-answers__choices"
              role="group"
              aria-label={`Jawaban checklist: ${item.label}`}
            >
              <button
                type="button"
                aria-pressed={answer === 'YES'}
                className={answer === 'YES' ? 'is-selected is-yes' : undefined}
                onClick={() => onChange(item.id, 'YES')}
              >
                <Check aria-hidden="true" /> Yes
              </button>
              <button
                type="button"
                aria-pressed={answer === 'NO'}
                className={answer === 'NO' ? 'is-selected is-no' : undefined}
                onClick={() => onChange(item.id, 'NO')}
              >
                <X aria-hidden="true" /> No
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ReadinessList({
  items,
}: {
  items: Array<{ label: string; complete: boolean; detail: string }>;
}) {
  return (
    <ul className="readiness-list">
      {items.map((item) => (
        <li key={item.label} className={item.complete ? 'is-complete' : 'is-incomplete'}>
          <span>{item.complete ? <Check /> : <CircleAlert />}</span>
          <span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ChangeEvidence({
  category,
  cause,
  detail,
}: {
  category: HenkatenCategory;
  cause: string;
  detail: string;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <section className={`change-evidence is-${category.toLowerCase()}`}>
      <header>
        <span>
          <Icon aria-hidden="true" />
        </span>
        <div>
          <h2>Penyebab &amp; detail</h2>
          <p>Evidence perubahan {meta.label}</p>
        </div>
      </header>
      <div className="change-evidence__body">
        <span>Ringkasan penyebab</span>
        <strong>{cause}</strong>
        <p>{detail}</p>
      </div>
    </section>
  );
}

export function ObjectTransitionEvidence({
  category,
  affected,
  replacement,
}: {
  category: HenkatenCategory;
  affected: string | null;
  replacement: string | null;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <section className={`object-transition is-${category.toLowerCase()}`}>
      <header>
        <span>
          <RefreshCw aria-hidden="true" />
        </span>
        <div>
          <h2>Objek terdampak / pengganti</h2>
          <p>Transisi kondisi {meta.label}</p>
        </div>
      </header>
      <div className="object-transition__flow">
        <div className="object-transition__node is-before">
          <span>Sebelum</span>
          <small>Objek terdampak</small>
          <strong>
            <Icon aria-hidden="true" />
            {affected || 'Tidak tersedia'}
          </strong>
        </div>
        <span className="object-transition__arrow" aria-hidden="true">
          <ArrowRight />
        </span>
        <div className="object-transition__node is-after">
          <span>Sesudah</span>
          <small>Kondisi pengganti</small>
          <strong>
            <Icon aria-hidden="true" />
            {replacement || 'Tidak tersedia'}
          </strong>
        </div>
      </div>
    </section>
  );
}

export function ManTransitionEvidence({
  replacedWasVacant,
  replacedMpName,
  replacementMpName,
  reservationActive,
  movement,
  formatDate,
}: {
  replacedWasVacant: boolean;
  replacedMpName: string | null;
  replacementMpName: string;
  reservationActive: boolean;
  movement: { movedMpName: string; replacedMpName: string | null; movedAt: string } | null;
  formatDate: (value: string) => string;
}) {
  return (
    <section className="object-transition is-man">
      <header>
        <span>
          <Workflow aria-hidden="true" />
        </span>
        <div>
          <h2>Reservation &amp; perpindahan</h2>
          <p>{movement ? 'Movement sudah diterapkan' : 'Perubahan assignment yang diajukan'}</p>
        </div>
      </header>
      <div className="object-transition__flow">
        <div className="object-transition__node is-before">
          <span>Assignment target</span>
          <small>MP sebelumnya</small>
          <strong>
            <UserRound aria-hidden="true" />
            {replacedWasVacant ? 'VACANT' : replacedMpName || 'Tidak tersedia'}
          </strong>
        </div>
        <span className="object-transition__arrow" aria-hidden="true">
          <ArrowRight />
        </span>
        <div className="object-transition__node is-after">
          <span>{movement ? 'Dipindahkan' : 'Replacement'}</span>
          <small>{movement ? formatDate(movement.movedAt) : 'MP yang direservasi'}</small>
          <strong>
            <UserRound aria-hidden="true" />
            {movement?.movedMpName ?? replacementMpName}
          </strong>
        </div>
      </div>
      <div className={`object-transition__state${reservationActive ? ' is-active' : ''}`}>
        {movement
          ? `Perpindahan selesai${movement.replacedMpName ? `; ${movement.replacedMpName} digantikan.` : '.'}`
          : reservationActive
            ? 'Reservation aktif. Assignment efektif belum berubah sampai approval final.'
            : 'Reservation sudah dilepas atau record telah menjadi terminal.'}
      </div>
    </section>
  );
}

export function ApprovalTimeline({
  creatorName,
  status,
  supervisor,
  qc,
  formatDate,
}: {
  creatorName: string;
  status: string;
  supervisor: ApprovalRoute;
  qc: ApprovalRoute;
  formatDate: (value: string) => string;
}) {
  const steps = [
    {
      key: 'submitted',
      label: 'Diajukan',
      state: 'APPROVED',
      person: creatorName,
      detail: 'Record dibuat',
      decidedAt: null,
    },
    routeStep('Supervisor', supervisor, formatDate),
    routeStep('QC', qc, formatDate),
    {
      key: 'completed',
      label: 'Hasil akhir',
      state: status === 'OPEN' ? 'PENDING' : status,
      person: status === 'OPEN' ? 'Belum terminal' : humanize(status),
      detail: status === 'OPEN' ? 'Menunggu keputusan final' : 'Lifecycle terminal',
      decidedAt: null,
    },
  ];
  return (
    <div className="approval-route">
      {steps.map((step, index) => (
        <div key={step.key} className={`is-${step.state.toLowerCase()}`}>
          <span className="approval-route__marker">
            {step.state === 'APPROVED' ? (
              <Check />
            ) : step.state === 'REJECTED' ? (
              <X />
            ) : step.state === 'NOT_REQUIRED' ? (
              <CircleAlert />
            ) : (
              index + 1
            )}
          </span>
          <strong>{step.label}</strong>
          <small>{step.person}</small>
          <em>{humanize(step.state)}</em>
          <p>{step.detail}</p>
          {step.decidedAt ? <time>{step.decidedAt}</time> : null}
        </div>
      ))}
    </div>
  );
}

function routeStep(label: string, route: ApprovalRoute, formatDate: (value: string) => string) {
  return {
    key: route.route,
    label,
    state: route.status,
    person: route.decision?.actorName ?? route.currentResponsibleName ?? 'Belum ditetapkan',
    detail:
      route.decision?.comment ||
      (route.status === 'PENDING'
        ? 'Menunggu keputusan'
        : route.status === 'NOT_REQUIRED'
          ? 'Tidak diperlukan'
          : 'Keputusan tersimpan'),
    decidedAt: route.decision ? formatDate(route.decision.decidedAt) : null,
  };
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());
}
