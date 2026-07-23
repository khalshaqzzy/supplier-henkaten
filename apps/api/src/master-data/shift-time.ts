export function timeToMinute(value: string): number {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(value);
  if (!match?.groups) throw new Error('InvalidLocalTime');
  return Number(match.groups['hour']) * 60 + Number(match.groups['minute']);
}

export function assertIanaTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error('InvalidIanaTimezone');
  }
}

export function businessDateForInstant(
  instant: Date,
  timezone: string,
  startMinute: number,
  endMinute: number,
): string {
  assertIanaTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const localDate = `${values['year']}-${values['month']}-${values['day']}`;
  const localMinute = Number(values['hour']) * 60 + Number(values['minute']);
  if (endMinute < startMinute && localMinute < endMinute) {
    const date = new Date(`${localDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  return localDate;
}
