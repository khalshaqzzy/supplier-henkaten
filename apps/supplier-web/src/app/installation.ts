const INSTALLATION_KEY = 'supplier-henkaten:installation-id';

export function getInstallationId(): string {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (
    existing &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
  ) {
    return existing;
  }
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}
