import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

export const test = base.extend<{ trackedBrowser: Browser }>({
  trackedBrowser: async ({ browser }, use, testInfo) => {
    const diagnostics: Array<Record<string, string>> = [];
    const instrument = (context: BrowserContext) => {
      context.on('page', (page) => {
        page.on('console', (message) => {
          if (message.type() === 'error') {
            const detail = message.text();
            diagnostics.push({
              kind: detail.startsWith('Failed to load resource:')
                ? 'network-console-error'
                : 'console-error',
              page: page.url(),
              detail,
            });
          }
        });
        page.on('pageerror', (error) => {
          diagnostics.push({ kind: 'page-error', page: page.url(), detail: error.message });
        });
        page.on('requestfailed', (request) => {
          diagnostics.push({
            kind: 'network-failure',
            method: request.method(),
            url: request.url(),
            detail: request.failure()?.errorText ?? 'unknown',
          });
        });
      });
    };
    const wrapped: Browser = new Proxy(browser, {
      get(target, property): unknown {
        if (property === 'newContext') {
          return async (...arguments_: Parameters<Browser['newContext']>) => {
            const context = await target.newContext(...arguments_);
            instrument(context);
            return context;
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function'
          ? (value as (...arguments_: unknown[]) => unknown).bind(target)
          : value;
      },
    });

    await use(wrapped);

    const browserErrors = diagnostics.filter(
      ({ kind }) => kind !== 'network-failure' && kind !== 'network-console-error',
    );
    if (browserErrors.length > 0 || testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('browser-console-and-network.json', {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: 'application/json',
      });
    }
    if (browserErrors.length > 0) {
      throw new Error(`Browser emitted ${browserErrors.length} console or page error(s).`);
    }
  },
});

export const runtime = {
  apiOrigin: required('E2E_API_ORIGIN'),
  supplierOrigin: required('E2E_SUPPLIER_ORIGIN'),
  tmminOrigin: required('E2E_TMMIN_ORIGIN'),
  bootstrapUsername: required('E2E_BOOTSTRAP_USERNAME'),
  bootstrapPassword: required('E2E_BOOTSTRAP_PASSWORD'),
  changedPassword: required('E2E_CHANGED_PASSWORD'),
};

type Session = {
  csrfToken: string;
  principal: {
    userId: string;
    role: string;
    mustChangePassword: boolean;
  };
  supplier?: { id: string; code: string };
};

export type Credential = { username: string; temporaryPassword: string };

export type HostedFixture = {
  supplier: { id: string; code: string; version: number };
  admin: Credential & { password: string };
  csrf: string;
  context: BrowserContext;
  request: APIRequestContext;
  line: { id: string };
  donorLine: { id: string };
  job: { id: string };
  donorJob: { id: string };
  part: { id: string };
  shiftTemplate: { id: string };
  members: Record<
    'supervisor' | 'leader' | 'donorLeader' | 'qc' | 'mp' | 'replacement',
    { id: string; credential?: Credential }
  >;
  checklists: Record<string, { id: string; itemId: string }>;
};

export async function loginBootstrapThroughUi(page: Page): Promise<string> {
  await page.goto(`${runtime.tmminOrigin}/login`);
  await page.getByLabel('Username').fill(runtime.bootstrapUsername);
  await page.getByLabel('Password').fill(runtime.bootstrapPassword);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Password sekarang').fill(runtime.bootstrapPassword);
  await page.getByLabel('Password baru', { exact: true }).fill(runtime.changedPassword);
  await page.getByLabel('Konfirmasi').fill(runtime.changedPassword);
  await page.getByRole('button', { name: 'Simpan dan masuk ulang' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill(runtime.bootstrapUsername);
  await page.getByLabel('Password').fill(runtime.changedPassword);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Ringkasan Global' })).toBeVisible();
  return sessionCsrf(page.context().request, 'tmmin');
}

export async function loginBootstrapThroughApi(request: APIRequestContext): Promise<string> {
  let session = await post<Session>(
    request,
    '/api/v1/auth/tmmin/login',
    { username: runtime.bootstrapUsername, password: runtime.bootstrapPassword },
    undefined,
  );
  if (session.principal.mustChangePassword) {
    await post(
      request,
      '/api/v1/auth/tmmin/change-password',
      { currentPassword: runtime.bootstrapPassword, newPassword: runtime.changedPassword },
      session.csrfToken,
      204,
    );
    session = await post<Session>(
      request,
      '/api/v1/auth/tmmin/login',
      { username: runtime.bootstrapUsername, password: runtime.changedPassword },
      undefined,
    );
  }
  return session.csrfToken;
}

export async function createHostedFixture(
  browser: Browser,
  tmminRequest: APIRequestContext,
  tmminCsrf: string,
  suffix: string,
): Promise<HostedFixture> {
  const code = `E2E-${suffix.toUpperCase()}`;
  const created = await post<{
    supplier: { id: string; code: string; version: number };
    credential: Credential;
  }>(
    tmminRequest,
    '/api/v1/tmmin/suppliers',
    {
      code,
      name: `E2E Hosted ${suffix}`,
      timezone: 'Asia/Jakarta',
      sourceMode: 'HOSTED',
      supplierAdmin: { username: `admin.${suffix}`, displayName: `Admin ${suffix}` },
    },
    tmminCsrf,
  );
  const context = await browser.newContext();
  const initial = await post<Session>(
    context.request,
    '/api/v1/auth/supplier/login',
    {
      supplierCode: code,
      username: created.credential.username,
      password: created.credential.temporaryPassword,
    },
    undefined,
  );
  const adminPassword = `E2e-Supplier-${suffix}-Password`;
  await post(
    context.request,
    '/api/v1/auth/supplier/change-password',
    { currentPassword: created.credential.temporaryPassword, newPassword: adminPassword },
    initial.csrfToken,
    204,
  );
  const adminSession = await post<Session>(
    context.request,
    '/api/v1/auth/supplier/login',
    {
      supplierCode: code,
      username: created.credential.username,
      password: adminPassword,
    },
    undefined,
  );
  const csrf = adminSession.csrfToken;
  const line = await post<{ id: string }>(
    context.request,
    '/api/v1/supplier/master-data/lines',
    { code: `LINE-${suffix}-A`, name: `Line ${suffix} A` },
    csrf,
  );
  const donorLine = await post<{ id: string }>(
    context.request,
    '/api/v1/supplier/master-data/lines',
    { code: `LINE-${suffix}-B`, name: `Line ${suffix} B` },
    csrf,
  );
  const job = await post<{ id: string }>(
    context.request,
    `/api/v1/supplier/master-data/lines/${line.id}/jobs`,
    { name: `Job ${suffix} A` },
    csrf,
  );
  const donorJob = await post<{ id: string }>(
    context.request,
    `/api/v1/supplier/master-data/lines/${donorLine.id}/jobs`,
    { name: `Job ${suffix} B` },
    csrf,
  );
  const part = await post<{ id: string }>(
    context.request,
    '/api/v1/supplier/master-data/parts',
    { partNumber: `PART-${suffix}`, partName: `Part ${suffix}` },
    csrf,
  );
  const shiftTemplate = await post<{ id: string }>(
    context.request,
    '/api/v1/supplier/master-data/shift-templates',
    { name: `Shift ${suffix}`, startTime: '06:00', endTime: '14:00', timezone: 'Asia/Jakarta' },
    csrf,
  );
  const members = {
    supervisor: await member(context.request, csrf, suffix, 'SUPERVISOR', 1),
    leader: await member(context.request, csrf, suffix, 'LINE_LEADER', 2),
    donorLeader: await member(context.request, csrf, suffix, 'LINE_LEADER', 3),
    qc: await member(context.request, csrf, suffix, 'QC', 4),
    mp: await member(context.request, csrf, suffix, 'MP', 5),
    replacement: await member(context.request, csrf, suffix, 'MP', 6),
  };
  const checklists: HostedFixture['checklists'] = {};
  for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD']) {
    const draft = await patch<{ version: number }>(
      context.request,
      `/api/v1/supplier/master-data/checklists/${category}/draft`,
      { items: [{ label: `${category} condition verified` }] },
      csrf,
    );
    const version = await post<{ id: string; items: Array<{ id: string }> }>(
      context.request,
      `/api/v1/supplier/master-data/checklists/${category}/publish`,
      { expectedVersion: draft.version },
      csrf,
    );
    checklists[category] = { id: version.id, itemId: version.items[0]!.id };
  }
  await post(
    context.request,
    `/api/v1/supplier/master-data/lines/${line.id}/default-supervisor`,
    { memberId: members.supervisor.id },
    csrf,
  );
  await post(
    context.request,
    `/api/v1/supplier/master-data/lines/${line.id}/default-line-leader`,
    { memberId: members.leader.id },
    csrf,
  );
  await post(
    context.request,
    `/api/v1/supplier/master-data/jobs/${job.id}/default-mp`,
    { memberId: members.mp.id },
    csrf,
  );
  await post(
    context.request,
    `/api/v1/supplier/master-data/lines/${donorLine.id}/default-supervisor`,
    { memberId: members.supervisor.id },
    csrf,
  );
  await post(
    context.request,
    `/api/v1/supplier/master-data/lines/${donorLine.id}/default-line-leader`,
    { memberId: members.donorLeader.id },
    csrf,
  );
  await post(
    context.request,
    `/api/v1/supplier/master-data/jobs/${donorJob.id}/default-mp`,
    { memberId: members.replacement.id },
    csrf,
  );

  return {
    supplier: created.supplier,
    admin: { ...created.credential, password: adminPassword },
    csrf,
    context,
    request: context.request,
    line,
    donorLine,
    job,
    donorJob,
    part,
    shiftTemplate,
    members,
    checklists,
  };
}

export async function loginRole(
  browser: Browser,
  supplierCode: string,
  credential: Credential,
  suffix: string,
): Promise<{ context: BrowserContext; csrf: string; password: string }> {
  const context = await browser.newContext();
  const initial = await post<Session>(
    context.request,
    '/api/v1/auth/supplier/login',
    {
      supplierCode,
      username: credential.username,
      password: credential.temporaryPassword,
    },
    undefined,
  );
  const password = `E2e-Role-${suffix}-Password`;
  await post(
    context.request,
    '/api/v1/auth/supplier/change-password',
    { currentPassword: credential.temporaryPassword, newPassword: password },
    initial.csrfToken,
    204,
  );
  const session = await post<Session>(
    context.request,
    '/api/v1/auth/supplier/login',
    { supplierCode, username: credential.username, password },
    undefined,
  );
  return { context, csrf: session.csrfToken, password };
}

export async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${runtime.apiOrigin}${path}`);
  await expectResponse(response, 200, path);
  return response.json() as Promise<T>;
}

export async function post<T = unknown>(
  request: APIRequestContext,
  path: string,
  body: unknown,
  csrf?: string,
  expectedStatus = path.endsWith('/login') ? 200 : 201,
  idempotencyKey?: string,
): Promise<T> {
  const response = await request.post(`${runtime.apiOrigin}${path}`, {
    data: body,
    headers: {
      ...realmOriginHeader(path),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  });
  await expectResponse(response, expectedStatus, path);
  return expectedStatus === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export async function patch<T>(
  request: APIRequestContext,
  path: string,
  body: unknown,
  csrf: string,
): Promise<T> {
  const response = await request.patch(`${runtime.apiOrigin}${path}`, {
    data: body,
    headers: { ...realmOriginHeader(path), 'X-CSRF-Token': csrf },
  });
  await expectResponse(response, 200, path);
  return response.json() as Promise<T>;
}

async function member(
  request: APIRequestContext,
  csrf: string,
  suffix: string,
  role: 'SUPERVISOR' | 'LINE_LEADER' | 'QC' | 'MP',
  sequence: number,
) {
  const result = await post<{ member: { id: string }; credential?: Credential }>(
    request,
    '/api/v1/supplier/master-data/members',
    {
      fullName: `${role} ${suffix} ${sequence}`,
      registrationNumber: `REG-${suffix}-${sequence}`,
      role,
      ...(role === 'MP' ? {} : { username: `${role.toLowerCase()}.${suffix}.${sequence}` }),
    },
    csrf,
  );
  return {
    id: result.member.id,
    ...(result.credential ? { credential: result.credential } : {}),
  };
}

async function sessionCsrf(request: APIRequestContext, realm: 'supplier' | 'tmmin') {
  const response = await request.get(`${runtime.apiOrigin}/api/v1/auth/${realm}/session`);
  await expectResponse(response, 200, `${realm} session`);
  return ((await response.json()) as Session).csrfToken;
}

async function expectResponse(response: APIResponse, expectedStatus: number, path: string) {
  if (response.status() !== expectedStatus) {
    throw new Error(
      `${path} returned ${response.status()}, expected ${expectedStatus}: ${await response.text()}`,
    );
  }
}

export function realmOriginHeader(path: string): { Origin: string } | Record<string, never> {
  if (path.startsWith('/api/v1/tmmin') || path.startsWith('/api/v1/auth/tmmin')) {
    return { Origin: runtime.tmminOrigin };
  }
  if (path.startsWith('/api/v1/supplier') || path.startsWith('/api/v1/auth/supplier')) {
    return { Origin: runtime.supplierOrigin };
  }
  return {};
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the E2E harness.`);
  return value;
}
