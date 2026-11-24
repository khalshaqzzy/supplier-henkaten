export type AccountTone = 'success' | 'warning' | 'neutral';

export function accountState(member: { account?: { status: string } | null | undefined }): {
  label: string;
  tone: AccountTone;
} {
  if (!member.account) return { label: 'Tanpa akun', tone: 'neutral' };
  return member.account.status === 'ACTIVE'
    ? { label: 'Akun aktif', tone: 'success' }
    : { label: 'Akun nonaktif', tone: 'warning' };
}

export function formatTimestamp(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    ...(timeZone ? { timeZone } : {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
