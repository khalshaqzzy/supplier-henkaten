import { describe, expect, it } from 'vitest';

import {
  InvalidWeeklyScheduleError,
  isUniformSchedule,
  normalizeWeeklySchedule,
  presentWeeklySchedule,
  resolveShiftOccurrence,
  scheduleForBusinessDate,
  weeklyScheduleLabel,
  weeklyScheduleOf,
  type ShiftScheduleSource,
} from './shift-schedule.js';
import { nextWeeklyRun, rotationSource } from './shift-rotation.service.js';

const weekdays = (startMinute: number, endMinute: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) =>
    dayOfWeek <= 5
      ? { dayOfWeek, isOff: false, startMinute, endMinute }
      : { dayOfWeek, isOff: true },
  );

const weekdayShift: ShiftScheduleSource = {
  startMinute: 420,
  endMinute: 960,
  timezone: 'Asia/Jakarta',
  weeklySchedule: weekdays(420, 960),
};

describe('weekly shift schedules', () => {
  it('treats a missing schedule as the same hours every day', () => {
    const days = weeklyScheduleOf({ startMinute: 480, endMinute: 1020, timezone: 'Asia/Jakarta' });
    expect(days).toHaveLength(7);
    expect(days.every((day) => !day.isOff && day.startMinute === 480)).toBe(true);
    expect(isUniformSchedule(days)).toBe(true);
  });

  it('validates seven unique days with at least one working day', () => {
    expect(() => normalizeWeeklySchedule(weekdays(420, 960).slice(0, 6))).toThrow(
      InvalidWeeklyScheduleError,
    );
    expect(() =>
      normalizeWeeklySchedule(
        [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, isOff: true })),
      ),
    ).toThrow(InvalidWeeklyScheduleError);
    expect(() =>
      normalizeWeeklySchedule([...weekdays(420, 960).slice(0, 6), { dayOfWeek: 1, isOff: true }]),
    ).toThrow(InvalidWeeklyScheduleError);
    const shuffled = [...weekdays(420, 960)].reverse();
    expect(normalizeWeeklySchedule(shuffled).map((day) => day.dayOfWeek)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('presents and labels off days', () => {
    const presented = presentWeeklySchedule(weekdayShift);
    expect(presented.isUniform).toBe(false);
    expect(presented.weeklySchedule[5]).toEqual({
      dayOfWeek: 6,
      isOff: true,
      startTime: null,
      endTime: null,
      crossesMidnight: false,
    });
    expect(weeklyScheduleLabel(weekdayShift)).toBe('Sen–Jum 07:00–16:00 · Sab–Min Libur');
    expect(scheduleForBusinessDate(weekdayShift, '2026-11-28')).toBeNull();
    expect(scheduleForBusinessDate(weekdayShift, '2026-11-27')).toEqual({
      startMinute: 420,
      endMinute: 960,
    });
  });

  it('skips off days when resolving the next occurrence', () => {
    // Saturday 2026-11-28 10:00 WIB: next working day is Monday 2026-11-30.
    const next = resolveShiftOccurrence(weekdayShift, new Date('2026-11-28T03:00:00.000Z'));
    expect(next.current).toBe(false);
    expect(next.start.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    // Wednesday 10:00 WIB is inside the shift.
    const current = resolveShiftOccurrence(weekdayShift, new Date('2026-11-25T03:00:00.000Z'));
    expect(current.current).toBe(true);
  });

  it('uses each day own hours and keeps an overnight shift on its start day', () => {
    const source: ShiftScheduleSource = {
      startMinute: 1320,
      endMinute: 360,
      timezone: 'Asia/Jakarta',
      weeklySchedule: [
        { dayOfWeek: 1, isOff: false, startMinute: 1320, endMinute: 360 },
        { dayOfWeek: 2, isOff: false, startMinute: 1320, endMinute: 360 },
        { dayOfWeek: 3, isOff: false, startMinute: 1320, endMinute: 360 },
        { dayOfWeek: 4, isOff: false, startMinute: 1320, endMinute: 360 },
        { dayOfWeek: 5, isOff: false, startMinute: 1260, endMinute: 300 },
        { dayOfWeek: 6, isOff: true },
        { dayOfWeek: 7, isOff: true },
      ],
    };
    // Saturday 03:00 WIB still belongs to Friday's 21:00–05:00 occurrence.
    const occurrence = resolveShiftOccurrence(source, new Date('2026-11-27T20:00:00.000Z'));
    expect(occurrence.current).toBe(true);
    expect(occurrence.startMinute).toBe(1260);
    expect(occurrence.end.toISOString()).toBe('2026-11-27T22:00:00.000Z');
  });
});

describe('weekly shift rotation timing', () => {
  it('returns the next matching weekday and time strictly after the given instant', () => {
    // Monday 2026-11-23 05:00 WIB, rotation every Monday 06:00 WIB.
    expect(
      nextWeeklyRun(1, 360, 'Asia/Jakarta', new Date('2026-11-22T22:00:00.000Z')).toISOString(),
    ).toBe('2026-11-22T23:00:00.000Z');
    // Exactly at the run time the next run is a week later.
    expect(
      nextWeeklyRun(1, 360, 'Asia/Jakarta', new Date('2026-11-22T23:00:00.000Z')).toISOString(),
    ).toBe('2026-11-29T23:00:00.000Z');
    // Sunday 23:30 in another timezone.
    expect(
      nextWeeklyRun(7, 1410, 'Europe/Berlin', new Date('2026-11-25T00:00:00.000Z')).toISOString(),
    ).toBe('2026-11-29T22:30:00.000Z');
  });

  it('rotates each shift to the next one, cyclically', () => {
    expect([0, 1].map((index) => rotationSource(index, 2))).toEqual([1, 0]);
    expect([0, 1, 2].map((index) => rotationSource(index, 3))).toEqual([1, 2, 0]);
  });
});
