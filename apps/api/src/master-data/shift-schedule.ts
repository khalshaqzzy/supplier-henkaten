import { Temporal } from '@js-temporal/polyfill';

import { Prisma } from '../generated/prisma/client.js';
import { databaseDate, shiftBoundaries } from '../shifts/shift-time.js';

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DaySchedule =
  | { dayOfWeek: IsoWeekday; isOff: true; startMinute: null; endMinute: null }
  | { dayOfWeek: IsoWeekday; isOff: false; startMinute: number; endMinute: number };

/** The subset of a ShiftTemplate row needed to resolve its weekly schedule. */
export type ShiftScheduleSource = {
  startMinute: number;
  endMinute: number;
  timezone: string;
  weeklySchedule?: Prisma.JsonValue | null;
};

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export class InvalidWeeklyScheduleError extends Error {
  constructor(reason: string) {
    super(`InvalidWeeklySchedule: ${reason}`);
  }
}

const isMinute = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1439;

/**
 * Validates seven day entries (any order) and returns them ordered Monday..Sunday. At least one
 * day must be a working day and every working day must have distinct start and end minutes.
 */
export function normalizeWeeklySchedule(days: readonly unknown[]): DaySchedule[] {
  if (days.length !== 7) throw new InvalidWeeklyScheduleError('seven days are required');
  const byDay = new Map<IsoWeekday, DaySchedule>();
  for (const raw of days) {
    if (!raw || typeof raw !== 'object') throw new InvalidWeeklyScheduleError('day is not object');
    const day = raw as Record<string, unknown>;
    const dayOfWeek = day['dayOfWeek'];
    if (!ISO_WEEKDAYS.includes(dayOfWeek as IsoWeekday))
      throw new InvalidWeeklyScheduleError('invalid weekday');
    if (byDay.has(dayOfWeek as IsoWeekday))
      throw new InvalidWeeklyScheduleError('duplicate weekday');
    if (day['isOff'] === true) {
      byDay.set(dayOfWeek as IsoWeekday, {
        dayOfWeek: dayOfWeek as IsoWeekday,
        isOff: true,
        startMinute: null,
        endMinute: null,
      });
      continue;
    }
    const startMinute = day['startMinute'];
    const endMinute = day['endMinute'];
    if (!isMinute(startMinute) || !isMinute(endMinute) || startMinute === endMinute)
      throw new InvalidWeeklyScheduleError('invalid working hours');
    byDay.set(dayOfWeek as IsoWeekday, {
      dayOfWeek: dayOfWeek as IsoWeekday,
      isOff: false,
      startMinute,
      endMinute,
    });
  }
  const ordered = ISO_WEEKDAYS.map((dayOfWeek) => byDay.get(dayOfWeek)!);
  if (ordered.every((day) => day.isOff))
    throw new InvalidWeeklyScheduleError('at least one working day is required');
  return ordered;
}

/** Stored schedule, or seven identical working days built from the representative minutes. */
export function weeklyScheduleOf(source: ShiftScheduleSource): DaySchedule[] {
  if (Array.isArray(source.weeklySchedule)) {
    try {
      return normalizeWeeklySchedule(source.weeklySchedule);
    } catch {
      // A malformed stored value falls back to the representative schedule below.
    }
  }
  return uniformWeeklySchedule(source.startMinute, source.endMinute);
}

export function uniformWeeklySchedule(startMinute: number, endMinute: number): DaySchedule[] {
  return ISO_WEEKDAYS.map((dayOfWeek) => ({
    dayOfWeek,
    isOff: false as const,
    startMinute,
    endMinute,
  }));
}

export function isUniformSchedule(days: readonly DaySchedule[]): boolean {
  const first = days[0];
  return Boolean(
    first &&
    !first.isOff &&
    days.every(
      (day) =>
        !day.isOff && day.startMinute === first.startMinute && day.endMinute === first.endMinute,
    ),
  );
}

/** The first working day of the week; mirrored into ShiftTemplate.startMinute/endMinute. */
export function representativeMinutes(days: readonly DaySchedule[]) {
  const first = days.find((day): day is Extract<DaySchedule, { isOff: false }> => !day.isOff);
  if (!first) throw new InvalidWeeklyScheduleError('at least one working day is required');
  return { startMinute: first.startMinute, endMinute: first.endMinute };
}

/**
 * Columns persisted for a schedule. A uniform week is stored as NULL so existing rows, setup
 * imports and previous releases keep reading only startMinute/endMinute.
 */
export function scheduleColumns(days: readonly DaySchedule[]) {
  const { startMinute, endMinute } = representativeMinutes(days);
  return {
    startMinute,
    endMinute,
    weeklySchedule: isUniformSchedule(days)
      ? Prisma.DbNull
      : (days.map((day) => ({ ...day })) as unknown as Prisma.InputJsonValue),
  };
}

export function dayScheduleFor(source: ShiftScheduleSource, dayOfWeek: number): DaySchedule {
  return weeklyScheduleOf(source)[dayOfWeek - 1]!;
}

export type ResolvedShiftOccurrence = {
  /** YYYY-MM-DD local business date (the day the occurrence starts). */
  businessDate: string;
  start: Date;
  end: Date;
  current: boolean;
  startMinute: number;
  endMinute: number;
};

/**
 * Resolves the occurrence running at `now`, otherwise the next one. Off days are skipped and an
 * overnight occurrence belongs to the day it starts, even when the next day is off.
 */
export function resolveShiftOccurrence(
  source: ShiftScheduleSource,
  now: Date,
): ResolvedShiftOccurrence {
  const days = weeklyScheduleOf(source);
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(source.timezone)
    .toPlainDate();
  let next: ResolvedShiftOccurrence | null = null;
  for (let offset = -1; offset <= 8; offset++) {
    const date = today.add({ days: offset });
    const day = days[date.dayOfWeek - 1]!;
    if (day.isOff) continue;
    const boundaries = shiftBoundaries(
      date.toString(),
      day.startMinute,
      day.endMinute,
      source.timezone,
    );
    const occurrence = {
      businessDate: databaseDate(date.toString()),
      start: boundaries.start,
      end: boundaries.end,
      startMinute: day.startMinute,
      endMinute: day.endMinute,
    };
    if (boundaries.start <= now && now < boundaries.end) return { ...occurrence, current: true };
    if (boundaries.start > now && (!next || boundaries.start < next.start))
      next = { ...occurrence, current: false };
  }
  if (!next) throw new InvalidWeeklyScheduleError('no working day');
  return next;
}

/** Working hours on one local business date, or null when that weekday is off. */
export function scheduleForBusinessDate(source: ShiftScheduleSource, businessDate: string) {
  const day = dayScheduleFor(source, Temporal.PlainDate.from(businessDate).dayOfWeek);
  return day.isOff ? null : { startMinute: day.startMinute, endMinute: day.endMinute };
}

export const minuteToTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** API representation of a weekly schedule. */
export function presentWeeklySchedule(source: ShiftScheduleSource) {
  const days = weeklyScheduleOf(source);
  return {
    weeklySchedule: days.map((day) =>
      day.isOff
        ? {
            dayOfWeek: day.dayOfWeek,
            isOff: true,
            startTime: null,
            endTime: null,
            crossesMidnight: false,
          }
        : {
            dayOfWeek: day.dayOfWeek,
            isOff: false,
            startTime: minuteToTime(day.startMinute),
            endTime: minuteToTime(day.endMinute),
            crossesMidnight: day.endMinute < day.startMinute,
          },
    ),
    isUniform: isUniformSchedule(days),
  };
}

const shortDay = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as const;

/** Compact Indonesian label such as "Sen–Jum 07:00–16:00 · Sab–Min Libur". */
export function weeklyScheduleLabel(source: ShiftScheduleSource): string {
  const days = weeklyScheduleOf(source);
  if (isUniformSchedule(days)) {
    const first = days[0] as Extract<DaySchedule, { isOff: false }>;
    return `${minuteToTime(first.startMinute)}–${minuteToTime(first.endMinute)}`;
  }
  const key = (day: DaySchedule) =>
    day.isOff ? 'off' : `${minuteToTime(day.startMinute)}–${minuteToTime(day.endMinute)}`;
  const groups: Array<{ from: number; to: number; value: string }> = [];
  days.forEach((day, index) => {
    const value = key(day);
    const last = groups.at(-1);
    if (last && last.value === value && last.to === index - 1) last.to = index;
    else groups.push({ from: index, to: index, value });
  });
  return groups
    .map(
      ({ from, to, value }) =>
        `${from === to ? shortDay[from] : `${shortDay[from]}–${shortDay[to]}`} ${value === 'off' ? 'Libur' : value}`,
    )
    .join(' · ');
}
