const INSTALLATION_KEY = 'supplier-henkaten:installation-id';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let volatileInstallationId: string | null = null;

export function getInstallationId(): string {
  try {
    const existing = localStorage.getItem(INSTALLATION_KEY);
    if (existing && UUID_V4_PATTERN.test(existing)) {
      volatileInstallationId = existing;
      return existing;
    }
    const created = volatileInstallationId ?? crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, created);
    volatileInstallationId = created;
    return created;
  } catch {
    volatileInstallationId ??= crypto.randomUUID();
    return volatileInstallationId;
  }
}
