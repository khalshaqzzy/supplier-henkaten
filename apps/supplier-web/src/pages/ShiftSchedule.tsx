import { useRef } from 'react';
import { CalendarDays, CopyCheck, Moon } from 'lucide-react';
import type { ShiftDaySchedule, WeeklyScheduleInput } from '@tmmin-henkaten/contracts';
import { Input, SegmentedControl, Switch } from '@tmmin-henkaten/ui';

import './shift-schedule.css';

export const DAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as const;
export const DAY_FULL = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const;
const WEEK = [1, 2, 3, 4, 5, 6, 7] as const;
const DAY_STRIP = ['Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb', 'Mg'] as const;

export type DayDraft = { dayOfWeek: number; isOff: boolean; startTime: string; endTime: string };
export type ScheduleDraft = {
  mode: 'UNIFORM' | 'PER_DAY';
  /** Times shared by every working day in UNIFORM mode. */
  startTime: string;
  endTime: string;
  days: DayDraft[];
};

const presets = [
  { id: 'ALL', label: 'Setiap hari', working: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'WEEKDAYS', label: 'Sen–Jum', working: [1, 2, 3, 4, 5] },
  { id: 'SIX', label: 'Sen–Sab', working: [1, 2, 3, 4, 5, 6] },
] as const;

export function defaultScheduleDraft(startTime = '08:00', endTime = '17:00'): ScheduleDraft {
  return {
    mode: 'UNIFORM',
    startTime,
    endTime,
    days: WEEK.map((dayOfWeek) => ({ dayOfWeek, isOff: false, startTime, endTime })),
  };
}

export function draftFromSchedule(
  weeklySchedule: readonly ShiftDaySchedule[] | undefined,
  fallback: { startTime: string; endTime: string },
): ScheduleDraft {
  if (!weeklySchedule?.length) return defaultScheduleDraft(fallback.startTime, fallback.endTime);
  const days = WEEK.map((dayOfWeek) => {
    const day = weeklySchedule.find((item) => item.dayOfWeek === dayOfWeek);
    return {
      dayOfWeek,
      isOff: day?.isOff ?? true,
      startTime: day?.startTime ?? fallback.startTime,
      endTime: day?.endTime ?? fallback.endTime,
    };
  });
  const working = days.filter((day) => !day.isOff);
  const first = working[0] ?? { startTime: fallback.startTime, endTime: fallback.endTime };
  const same = working.every(
    (day) => day.startTime === first.startTime && day.endTime === first.endTime,
  );
  return {
    mode: same ? 'UNIFORM' : 'PER_DAY',
    startTime: first.startTime,
    endTime: first.endTime,
    days,
  };
}

/** The 7-day payload the API expects, whatever editing mode is active. */
export function scheduleFromDraft(draft: ScheduleDraft): WeeklyScheduleInput {
  return draft.days.map((day) =>
    day.isOff
      ? { dayOfWeek: day.dayOfWeek, isOff: true as const }
      : {
          dayOfWeek: day.dayOfWeek,
          isOff: false as const,
          startTime: draft.mode === 'UNIFORM' ? draft.startTime : day.startTime,
          endTime: draft.mode === 'UNIFORM' ? draft.endTime : day.endTime,
        },
  );
}

export function scheduleProblem(draft: ScheduleDraft): string | null {
  const days = scheduleFromDraft(draft);
  if (!days.some((day) => !day.isOff)) return 'Pilih minimal satu hari kerja.';
  const invalid = days.find((day) => !day.isOff && day.startTime === day.endTime);
  if (invalid) return `Jam mulai dan selesai ${DAY_FULL[invalid.dayOfWeek - 1]} tidak boleh sama.`;
  if (days.some((day) => !day.isOff && (!day.startTime || !day.endTime)))
    return 'Lengkapi jam mulai dan selesai.';
  return null;
}

const toMinute = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const durationMinutes = (start: string, end: string) => {
  const diff = toMinute(end) - toMinute(start);
  return diff <= 0 ? diff + 1440 : diff;
};
const crosses = (start: string, end: string) => toMinute(end) <= toMinute(start);
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} j ${rest} m` : `${hours} jam`;
}

type DayLike = Pick<ShiftDaySchedule, 'dayOfWeek' | 'isOff' | 'startTime' | 'endTime'>;

/** "Sen–Jum 07:00–16:00 · Sab–Min Libur", grouping consecutive days with identical times. */
export function scheduleLabel(days: readonly DayLike[]): string {
  const ordered = [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const key = (day: DayLike) => (day.isOff ? 'OFF' : `${day.startTime}–${day.endTime}`);
  const groups: Array<{ key: string; from: number; to: number }> = [];
  for (const day of ordered) {
    const last = groups.at(-1);
    if (last && last.key === key(day) && last.to === day.dayOfWeek - 1) last.to = day.dayOfWeek;
    else groups.push({ key: key(day), from: day.dayOfWeek, to: day.dayOfWeek });
  }
  if (groups.length === 1)
    return groups[0]!.key === 'OFF' ? 'Libur' : `Setiap hari ${groups[0]!.key}`;
  return groups
    .map(({ key: value, from, to }) => {
      const range =
        from === to ? DAY_SHORT[from - 1] : `${DAY_SHORT[from - 1]}–${DAY_SHORT[to - 1]}`;
      return `${range} ${value === 'OFF' ? 'Libur' : value}`;
    })
    .join(' · ');
}

/** Compact Mon–Sun strip: filled cells work, hollow cells are off. */
export function ShiftDayStrip({ days }: { days: readonly ShiftDaySchedule[] }) {
  return (
    <span className="shift-strip" role="img" aria-label={scheduleLabel(days)}>
      {WEEK.map((dayOfWeek) => {
        const day = days.find((item) => item.dayOfWeek === dayOfWeek);
        const off = !day || day.isOff;
        return (
          <span
            key={dayOfWeek}
            className={off ? 'shift-strip__day is-off' : 'shift-strip__day'}
            title={`${DAY_FULL[dayOfWeek - 1]}: ${off ? 'Libur' : `${day.startTime}–${day.endTime}`}`}
          >
            {DAY_STRIP[dayOfWeek - 1]}
          </span>
        );
      })}
    </span>
  );
}

export function ShiftScheduleCell({
  days,
  isUniform,
}: {
  days: readonly ShiftDaySchedule[];
  isUniform: boolean;
}) {
  const working = days.filter((day) => !day.isOff);
  const first = working[0];
  const sameTimes = working.every(
    (day) => day.startTime === first?.startTime && day.endTime === first?.endTime,
  );
  return (
    <span className="shift-schedule-cell">
      <ShiftDayStrip days={days} />
      <span className="shift-schedule-cell__text" title={scheduleLabel(days)}>
        {first && (isUniform || sameTimes) ? (
          <>
            <strong>
              {first.startTime}–{first.endTime}
            </strong>
            {first.crossesMidnight && <em className="shift-pill">+1 hari</em>}
          </>
        ) : (
          <strong>Jam berbeda per hari</strong>
        )}
      </span>
    </span>
  );
}

function DayTrack({ start, end, off }: { start: string; end: string; off: boolean }) {
  if (off) return <div className="shift-track is-off" aria-hidden="true" />;
  const from = toMinute(start);
  const to = toMinute(end);
  const spans =
    to <= from
      ? [
          [from, 1440],
          [0, to],
        ]
      : [[from, to]];
  return (
    <div className="shift-track" aria-hidden="true">
      <i style={{ left: '25%' }} />
      <i style={{ left: '50%' }} />
      <i style={{ left: '75%' }} />
      {spans.map(([a, b], index) => (
        <span
          key={index}
          className={index === 1 ? 'is-overflow' : undefined}
          style={{ left: `${(a! / 1440) * 100}%`, width: `${((b! - a!) / 1440) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function ShiftWeeklyScheduleEditor({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  disabled?: boolean;
}) {
  const days = scheduleFromDraft(value);
  const working = days.filter((day) => !day.isOff);
  const allValid = working.every(
    (day) => day.startTime && day.endTime && day.startTime !== day.endTime,
  );
  const weeklyMinutes = working.reduce(
    (sum, day) => sum + (day.isOff ? 0 : durationMinutes(day.startTime, day.endTime)),
    0,
  );
  // Per-day hours set before switching to "Jam sama", restored when switching back unchanged.
  const perDayStash = useRef<{ days: DayDraft[]; startTime: string; endTime: string } | null>(null);
  const activePreset = presets.find(
    (preset) =>
      preset.working.length === working.length &&
      preset.working.every((dayOfWeek) => working.some((day) => day.dayOfWeek === dayOfWeek)),
  )?.id;
  const setDay = (dayOfWeek: number, patch: Partial<DayDraft>) =>
    onChange({
      ...value,
      days: value.days.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    });
  const applyPreset = (workingDays: readonly number[]) =>
    onChange({
      ...value,
      days: value.days.map((day) => ({ ...day, isOff: !workingDays.includes(day.dayOfWeek) })),
    });
  const switchMode = (mode: string) => {
    if (mode === value.mode) return;
    if (mode === 'PER_DAY') {
      const stash = perDayStash.current;
      const restore =
        stash && stash.startTime === value.startTime && stash.endTime === value.endTime;
      perDayStash.current = null;
      onChange({
        ...value,
        mode: 'PER_DAY',
        days: value.days.map((day) => {
          const saved = restore
            ? stash.days.find((item) => item.dayOfWeek === day.dayOfWeek)
            : null;
          return {
            ...day,
            startTime: saved?.startTime ?? value.startTime,
            endTime: saved?.endTime ?? value.endTime,
          };
        }),
      });
    } else {
      const first = value.days.find((day) => !day.isOff) ?? value.days[0]!;
      perDayStash.current = {
        days: value.days,
        startTime: first.startTime,
        endTime: first.endTime,
      };
      onChange({ ...value, mode: 'UNIFORM', startTime: first.startTime, endTime: first.endTime });
    }
  };
  const copyToAll = (source: DayDraft) =>
    onChange({
      ...value,
      days: value.days.map((day) =>
        day.isOff ? day : { ...day, startTime: source.startTime, endTime: source.endTime },
      ),
    });

  return (
    <section className="shift-editor" aria-label="Jadwal mingguan">
      <header className="shift-editor__head">
        <div>
          <span className="shift-editor__eyebrow">
            <CalendarDays aria-hidden="true" /> Jadwal mingguan
          </span>
          <strong>{scheduleLabel(days.map(toDayLike))}</strong>
        </div>
        <SegmentedControl
          label="Mode jadwal"
          value={value.mode}
          onValueChange={switchMode}
          options={[
            { value: 'UNIFORM', label: 'Jam sama', disabled: Boolean(disabled) },
            { value: 'PER_DAY', label: 'Per hari', disabled: Boolean(disabled) },
          ]}
        />
      </header>

      <div className="shift-editor__presets" role="group" aria-label="Hari kerja cepat">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={activePreset === preset.id ? 'shift-chip is-selected' : 'shift-chip'}
            aria-pressed={activePreset === preset.id}
            disabled={Boolean(disabled)}
            onClick={() => applyPreset(preset.working)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {value.mode === 'UNIFORM' ? (
        <div className="shift-editor__uniform">
          <div className="shift-editor__days" role="group" aria-label="Hari kerja">
            {value.days.map((day) => (
              <button
                key={day.dayOfWeek}
                type="button"
                className={day.isOff ? 'shift-day-pill' : 'shift-day-pill is-on'}
                aria-pressed={!day.isOff}
                aria-label={`${DAY_FULL[day.dayOfWeek - 1]} ${day.isOff ? 'libur' : 'kerja'}`}
                disabled={Boolean(disabled)}
                onClick={() => setDay(day.dayOfWeek, { isOff: !day.isOff })}
              >
                <span>{DAY_SHORT[day.dayOfWeek - 1]}</span>
                <small>{day.isOff ? 'Libur' : 'Kerja'}</small>
              </button>
            ))}
          </div>
          <div className="shift-editor__times">
            <label>
              <span>Mulai</span>
              <Input
                id="startTime"
                type="time"
                required
                disabled={Boolean(disabled)}
                value={value.startTime}
                onChange={(event) => onChange({ ...value, startTime: event.target.value })}
              />
            </label>
            <label>
              <span>Selesai</span>
              <Input
                id="endTime"
                type="time"
                required
                disabled={Boolean(disabled)}
                value={value.endTime}
                onChange={(event) => onChange({ ...value, endTime: event.target.value })}
              />
            </label>
            <div className="shift-editor__duration">
              <span>Durasi</span>
              <strong>
                {value.startTime && value.endTime && value.startTime !== value.endTime
                  ? formatDuration(durationMinutes(value.startTime, value.endTime))
                  : '—'}
              </strong>
              {value.startTime &&
                value.endTime &&
                value.startTime !== value.endTime &&
                crosses(value.startTime, value.endTime) && (
                  <em className="shift-pill">
                    <Moon aria-hidden="true" /> +1 hari
                  </em>
                )}
            </div>
          </div>
          <DayTrack
            start={value.startTime}
            end={value.endTime}
            off={
              working.length === 0 ||
              !value.startTime ||
              !value.endTime ||
              value.startTime === value.endTime
            }
          />
          <TrackAxis />
        </div>
      ) : (
        <ol className="shift-editor__rows">
          {value.days.map((day) => {
            const valid = day.startTime && day.endTime && day.startTime !== day.endTime;
            return (
              <li key={day.dayOfWeek} className={day.isOff ? 'is-off' : undefined}>
                <div className="shift-editor__row-day">
                  <Switch
                    checked={!day.isOff}
                    disabled={Boolean(disabled)}
                    onCheckedChange={(checked) => setDay(day.dayOfWeek, { isOff: !checked })}
                    label={DAY_FULL[day.dayOfWeek - 1]}
                  />
                </div>
                {day.isOff ? (
                  <span className="shift-editor__off">Libur</span>
                ) : (
                  <div className="shift-editor__row-times">
                    <Input
                      type="time"
                      aria-label={`Mulai ${DAY_FULL[day.dayOfWeek - 1]}`}
                      required
                      disabled={Boolean(disabled)}
                      value={day.startTime}
                      onChange={(event) => setDay(day.dayOfWeek, { startTime: event.target.value })}
                    />
                    <span aria-hidden="true">–</span>
                    <Input
                      type="time"
                      aria-label={`Selesai ${DAY_FULL[day.dayOfWeek - 1]}`}
                      required
                      disabled={Boolean(disabled)}
                      value={day.endTime}
                      onChange={(event) => setDay(day.dayOfWeek, { endTime: event.target.value })}
                    />
                    <span className="shift-editor__row-meta">
                      {valid ? formatDuration(durationMinutes(day.startTime, day.endTime)) : '—'}
                      {valid && crosses(day.startTime, day.endTime) && (
                        <em className="shift-pill" title="Selesai hari berikutnya">
                          +1<span className="hds-sr-only"> hari</span>
                        </em>
                      )}
                    </span>
                    <button
                      type="button"
                      className="shift-editor__copy"
                      disabled={disabled || !valid}
                      aria-label={`Terapkan jam ${DAY_FULL[day.dayOfWeek - 1]} ke semua hari kerja`}
                      title="Terapkan ke semua hari kerja"
                      onClick={() => copyToAll(day)}
                    >
                      <CopyCheck aria-hidden="true" />
                    </button>
                  </div>
                )}
                <DayTrack start={day.startTime} end={day.endTime} off={day.isOff || !valid} />
              </li>
            );
          })}
          <li className="shift-editor__axis-row" aria-hidden="true">
            <span />
            <span />
            <TrackAxis />
          </li>
        </ol>
      )}

      <footer className="shift-editor__summary">
        <div>
          <span>Hari kerja</span>
          <strong>{working.length} / 7</strong>
        </div>
        <div>
          <span>Total per minggu</span>
          <strong>{working.length && allValid ? formatDuration(weeklyMinutes) : '—'}</strong>
        </div>
        <div>
          <span>Libur</span>
          <strong>
            {days
              .filter((day) => day.isOff)
              .map((day) => DAY_SHORT[day.dayOfWeek - 1])
              .join(', ') || '—'}
          </strong>
        </div>
      </footer>
    </section>
  );
}

function TrackAxis() {
  return (
    <div className="shift-track-axis" aria-hidden="true">
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  );
}

function toDayLike(day: WeeklyScheduleInput[number]): DayLike {
  return day.isOff
    ? { dayOfWeek: day.dayOfWeek, isOff: true, startTime: null, endTime: null }
    : { dayOfWeek: day.dayOfWeek, isOff: false, startTime: day.startTime, endTime: day.endTime };
}
