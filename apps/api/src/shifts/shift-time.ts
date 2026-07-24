import { Temporal } from '@js-temporal/polyfill';

export function shiftBoundaries(
  businessDate: string,
  startMinute: number,
  endMinute: number,
  timezone: string,
): { start: Date; end: Date } {
  const date = Temporal.PlainDate.from(businessDate);
  const startTime = Temporal.PlainTime.from({
    hour: Math.floor(startMinute / 60),
    minute: startMinute % 60,
  });
  const endTime = Temporal.PlainTime.from({
    hour: Math.floor(endMinute / 60),
    minute: endMinute % 60,
  });
  const start = date.toZonedDateTime({ timeZone: timezone, plainTime: startTime });
  const endDate = endMinute < startMinute ? date.add({ days: 1 }) : date;
  const end = endDate.toZonedDateTime({ timeZone: timezone, plainTime: endTime });
  return {
    start: new Date(start.epochMilliseconds),
    end: new Date(end.epochMilliseconds),
  };
}

export function databaseDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
