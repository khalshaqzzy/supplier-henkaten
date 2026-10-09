import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';

import {
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  post,
  realmOriginHeader,
  runtime,
  test,
  type Credential,
} from './support.js';

test('proves TMMIN read-only governance, source cutover, and External ingestion controls @edge', async ({
  trackedBrowser: browser,
}) => {
  const tmminContext = await browser.newContext();
  const tmminCsrf = await loginBootstrapThroughApi(tmminContext.request);

  const missingCsrf = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/tmmin/quality-users`,
    {
      data: { username: 'blocked.missing.csrf', displayName: 'Blocked Missing CSRF' },
      headers: realmOriginHeader('/api/v1/tmmin/quality-users'),
    },
  );
  expect(missingCsrf.status()).toBe(403);
  const foreignOrigin = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/tmmin/quality-users`,
    {
      data: { username: 'blocked.foreign.origin', displayName: 'Blocked Foreign Origin' },
      headers: { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': tmminCsrf },
    },
  );
  expect(foreignOrigin.status()).toBe(403);

  const qualityCreated = await post<{
    credential: Credential;
  }>(
    tmminContext.request,
    '/api/v1/tmmin/quality-users',
    { username: 'quality.e2e', displayName: 'Quality E2E' },
    tmminCsrf,
  );
  const qualityContext = await browser.newContext();
  const qualityInitial = await post<Session>(
    qualityContext.request,
    '/api/v1/auth/tmmin/login',
    {
      username: qualityCreated.credential.username,
      password: qualityCreated.credential.temporaryPassword,
    },
    undefined,
  );
  const qualityPassword = 'E2e-Quality-Changed-Password';
  await post(
    qualityContext.request,
    '/api/v1/auth/tmmin/change-password',
    {
      currentPassword: qualityCreated.credential.temporaryPassword,
      newPassword: qualityPassword,
    },
    qualityInitial.csrfToken,
    204,
  );
  const qualitySession = await post<Session>(
    qualityContext.request,
    '/api/v1/auth/tmmin/login',
    { username: qualityCreated.credential.username, password: qualityPassword },
    undefined,
  );

  const hosted = await createHostedFixture(browser, tmminContext.request, tmminCsrf, 'governance');
  const currentHosted = await get<{ supplier: { version: number } }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${hosted.supplier.id}`,
  );
  await post(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${hosted.supplier.id}/external-clients`,
    { name: 'Hosted cutover credential', ipAllowlist: [] },
    tmminCsrf,
  );
  const preflight = await post<{ eligible: boolean }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${hosted.supplier.id}/source/preflight`,
    { targetMode: 'EXTERNAL' },
    tmminCsrf,
    200,
  );
  expect(preflight.eligible).toBe(true);
  const cutover = await post<{ sourceMode: string; sourceEpoch: number }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${hosted.supplier.id}/source/cutover`,
    {
      targetMode: 'EXTERNAL',
      expectedVersion: currentHosted.supplier.version,
      reason: 'E2E source transition evidence',
      privacyAcknowledged: true,
    },
    tmminCsrf,
    200,
  );
  expect(cutover.sourceMode).toBe('EXTERNAL');
  expect(cutover.sourceEpoch).toBe(2);
  const revokedHostedSession = await hosted.context.request.get(
    `${runtime.apiOrigin}/api/v1/auth/supplier/session`,
  );
  expect(revokedHostedSession.status()).toBe(401);

  const externalSupplier = await post<{
    supplier: { id: string; code: string; version: number };
  }>(
    tmminContext.request,
    '/api/v1/tmmin/suppliers',
    {
      code: 'E2E-EXTERNAL',
      name: 'E2E External Supplier',
      timezone: 'Asia/Jakarta',
      sourceMode: 'EXTERNAL',
    },
    tmminCsrf,
  );
  const credential = await post<{
    client: { id: string; clientId: string; version: number };
    clientSecret: string;
  }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-clients`,
    { name: 'E2E external client', ipAllowlist: [] },
    tmminCsrf,
  );
  await post(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/activate`,
    { expectedVersion: externalSupplier.supplier.version },
    tmminCsrf,
    200,
  );
  const tokenResponse = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/auth/token`,
    {
      data: { client_id: credential.client.clientId, client_secret: credential.clientSecret },
    },
  );
  expect(tokenResponse.status()).toBe(200);
  const token = ((await tokenResponse.json()) as { access_token: string }).access_token;
  const opened = externalEvent('external-open-1', 'source-henkaten-1', 1, 'HENKATEN_OPENED');
  const accepted = await ingest(tmminContext.request, token, opened, 202);
  expect(accepted.status).toBe('ACCEPTED');
  const duplicate = await ingest(tmminContext.request, token, opened, 200);
  expect(duplicate.status).toBe('DUPLICATE');

  const conflictResponse = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/henkaten/events`,
    {
      data: { ...opened, change: { ...opened.change, detail: 'Conflicting payload' } },
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(conflictResponse.status()).toBe(409);
  expect((await conflictResponse.json()).code).toBe('IDEMPOTENCY_CONFLICT');

  const outOfOrder = externalEvent(
    'external-gap-1',
    'source-henkaten-1',
    3,
    'HENKATEN_OPEN_UPDATED',
  );
  const gapResponse = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/henkaten/events`,
    { data: outOfOrder, headers: { Authorization: `Bearer ${token}` } },
  );
  expect(gapResponse.status()).toBe(422);

  const approved = externalEvent(
    'external-approved-1',
    'source-henkaten-1',
    2,
    'HENKATEN_APPROVED',
  );
  approved.status = 'APPROVED';
  approved.decisions = [
    {
      route: 'SUPERVISOR',
      decision: 'APPROVED',
      actorRef: 'supervisor-ref',
      decidedAt: new Date().toISOString(),
    },
    {
      route: 'QC',
      decision: 'APPROVED',
      actorRef: 'qc-ref',
      decidedAt: new Date().toISOString(),
    },
  ];
  expect((await ingest(tmminContext.request, token, approved, 202)).status).toBe('ACCEPTED');

  const rejectedOpen = externalEvent(
    'external-rejected-open',
    'source-henkaten-rejected',
    1,
    'HENKATEN_OPENED',
  );
  expect((await ingest(tmminContext.request, token, rejectedOpen, 202)).status).toBe('ACCEPTED');
  const rejected = externalEvent(
    'external-rejected-terminal',
    'source-henkaten-rejected',
    2,
    'HENKATEN_REJECTED',
  );
  rejected.status = 'REJECTED';
  rejected.decisions = [
    {
      route: 'QC',
      decision: 'REJECTED',
      actorRef: 'qc-reject-ref',
      decidedAt: new Date().toISOString(),
    },
  ];
  expect((await ingest(tmminContext.request, token, rejected, 202)).status).toBe('ACCEPTED');

  const cancelledOpen = externalEvent(
    'external-cancelled-open',
    'source-henkaten-cancelled',
    1,
    'HENKATEN_OPENED',
  );
  expect((await ingest(tmminContext.request, token, cancelledOpen, 202)).status).toBe('ACCEPTED');
  const cancelled = externalEvent(
    'external-cancelled-terminal',
    'source-henkaten-cancelled',
    2,
    'HENKATEN_CANCELLED',
  );
  cancelled.status = 'CANCELLED';
  cancelled.cancellationReason = 'External shift ended';
  expect((await ingest(tmminContext.request, token, cancelled, 202)).status).toBe('ACCEPTED');

  const batchResponse = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/henkaten/events/batch`,
    {
      data: {
        events: [
          externalEvent('external-batch-valid', 'source-batch-valid', 1, 'HENKATEN_OPENED'),
          {
            ...externalEvent('external-batch-pii', 'source-batch-pii', 1, 'HENKATEN_OPENED'),
            employeeEmail: 'forbidden@example.invalid',
          },
        ],
      },
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(batchResponse.status()).toBe(200);
  expect(((await batchResponse.json()) as { results: Array<{ status: string }> }).results).toEqual([
    expect.objectContaining({ status: 'ACCEPTED' }),
    expect.objectContaining({ status: 'REJECTED' }),
  ]);

  const projections = await get<{ items: Array<{ status: string; sourceMode: string }> }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-projections?limit=25`,
  );
  expect(projections.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: 'APPROVED', sourceMode: 'EXTERNAL' }),
    ]),
  );
  const health = await get<{ totals: { accepted: number; duplicate: number; rejected: number } }>(
    tmminContext.request,
    `/api/v1/tmmin/external-health?supplierId=${externalSupplier.supplier.id}&limit=25`,
  );
  expect(health.totals.accepted).toBeGreaterThanOrEqual(3);
  expect(health.totals.duplicate).toBeGreaterThanOrEqual(1);
  expect(health.totals.rejected).toBeGreaterThanOrEqual(3);

  const tmminPage = await tmminContext.newPage();
  await tmminPage.goto(runtime.tmminOrigin);
  await expect(tmminPage.getByRole('heading', { name: 'Ringkasan Global' })).toBeVisible();
  const sourceMetrics = tmminPage.getByRole('region', {
    name: 'Supplier aktif berdasarkan sumber',
  });
  await expect(sourceMetrics.getByText('Hosted', { exact: true })).toBeVisible();
  await expect(sourceMetrics.getByText('External', { exact: true })).toBeVisible();
  await tmminPage.goto(`${runtime.tmminOrigin}/suppliers/${externalSupplier.supplier.id}`);
  const deactivateTrigger = tmminPage.getByRole('button', { name: 'Nonaktifkan', exact: true });
  await tmminPage.bringToFront();
  await deactivateTrigger.click();
  const deactivateDialog = tmminPage.getByRole('dialog', {
    name: 'Nonaktifkan supplier?',
  });
  await expect(deactivateDialog).toBeVisible();
  for (let step = 0; step < 5; step += 1) {
    await tmminPage.keyboard.press('Tab');
    expect(
      await deactivateDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
  }
  await tmminPage.keyboard.press('Escape');
  await expect(deactivateDialog).toBeHidden();
  await expect(deactivateTrigger).toBeFocused();
  await tmminPage.goto(`${runtime.tmminOrigin}/warnings`);
  await expect(tmminPage.getByRole('heading', { name: 'Peringatan Aktif' })).toBeVisible();
  await expect(tmminPage.locator('tbody').getByText('E2E External Supplier')).toBeVisible();
  await tmminPage.getByRole('link', { name: 'Lihat detail' }).first().click();
  await expect(tmminPage.getByText('EXTERNAL', { exact: true }).first()).toBeVisible();
  await tmminPage.goto(`${runtime.tmminOrigin}/henkatens?sourceMode=EXTERNAL`);
  await expect(tmminPage.getByRole('heading', { name: 'Henkaten', exact: true })).toBeVisible();
  await expect(tmminPage.getByText(/EXTERNAL · E1/).first()).toBeVisible();

  const forbiddenMutation = await qualityContext.request.post(
    `${runtime.apiOrigin}/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/source/preflight`,
    {
      data: { targetMode: 'HOSTED' },
      headers: {
        ...realmOriginHeader('/api/v1/tmmin/suppliers'),
        'X-CSRF-Token': qualitySession.csrfToken,
      },
    },
  );
  expect(forbiddenMutation.status()).toBe(403);

  const qualityPage = await qualityContext.newPage();
  await qualityPage.goto(`${runtime.tmminOrigin}/external-health`);
  await expect(
    qualityPage.getByRole('heading', { name: 'Kesehatan Ingesti External' }),
  ).toBeVisible();
  await expect(qualityPage.getByRole('button', { name: /rotate|revoke|issue/i })).toHaveCount(0);
  expect((await new AxeBuilder({ page: qualityPage }).analyze()).violations).toEqual([]);

  // Admin removes an Approved record; Quality removes the remaining supplier history.
  const visibleRecords = await get<{ items: Array<{ id: string; status: string }> }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-projections?limit=25`,
  );
  const approvedRecord = visibleRecords.items.find((row) => row.status === 'APPROVED')!;
  await tmminPage.goto(
    `${runtime.tmminOrigin}/henkatens/external/${externalSupplier.supplier.id}/${approvedRecord.id}`,
  );
  await tmminPage.getByRole('button', { name: 'Hapus Henkaten', exact: true }).click();
  const individualDelete = tmminPage.getByRole('dialog', { name: 'Hapus Henkaten?' });
  await expect(
    individualDelete.getByRole('button', { name: 'Hapus Henkaten', exact: true }),
  ).toBeDisabled();
  await individualDelete.getByLabel('Alasan penghapusan').fill('Data approved duplikat');
  expect(
    (await new AxeBuilder({ page: tmminPage }).include('[role=dialog]').analyze()).violations,
  ).toEqual([]);
  await tmminPage.screenshot({ path: '/tmp/henkaten-deletion-individual.png', fullPage: true });
  await individualDelete.getByRole('button', { name: 'Hapus Henkaten', exact: true }).click();
  await expect(
    tmminPage.getByRole('status').filter({ hasText: 'Henkaten dihapus.' }),
  ).toBeVisible();
  expect(
    (
      await tmminContext.request.get(
        `${runtime.apiOrigin}/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-projections/${approvedRecord.id}`,
      )
    ).status(),
  ).toBe(404);
  await qualityPage.goto(`${runtime.tmminOrigin}/suppliers/${externalSupplier.supplier.id}`);
  await qualityPage.bringToFront();
  await qualityPage.getByRole('button', { name: 'Hapus semua Henkaten', exact: true }).click();
  const bulkDelete = qualityPage.getByRole('dialog', { name: 'Hapus semua Henkaten?' });
  await expect(bulkDelete.getByText('Henkaten akan dihapus', { exact: true })).toBeVisible();
  await bulkDelete.getByLabel('Alasan penghapusan').fill('Bersihkan Henkaten supplier');
  await bulkDelete.getByLabel(/Ketik E2E-EXTERNAL/).fill('WRONG');
  await expect(bulkDelete.getByRole('button', { name: 'Hapus semua', exact: true })).toBeDisabled();
  await bulkDelete.getByLabel(/Ketik E2E-EXTERNAL/).fill('E2E-EXTERNAL');
  for (let step = 0; step < 7; step += 1) {
    await qualityPage.keyboard.press('Tab');
    expect(await bulkDelete.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(
      true,
    );
  }
  expect(
    (await new AxeBuilder({ page: qualityPage }).include('[role=dialog]').analyze()).violations,
  ).toEqual([]);
  await qualityPage.setViewportSize({ width: 390, height: 844 });
  await qualityPage.screenshot({ path: '/tmp/henkaten-deletion-bulk-mobile.png', fullPage: true });
  expect(
    await qualityPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await bulkDelete.getByRole('button', { name: 'Hapus semua', exact: true }).click();
  await expect(bulkDelete).toBeHidden();
  await expect(
    qualityPage.getByRole('status').filter({ hasText: /Henkaten dihapus/ }),
  ).toBeVisible();
  const removedRecords = await get<{ items: unknown[] }>(
    qualityContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-projections?limit=25`,
  );
  expect(removedRecords.items).toEqual([]);
  const removedReplay = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/henkaten/events`,
    { data: opened, headers: { Authorization: `Bearer ${token}` } },
  );
  expect(removedReplay.status()).toBe(422);
  expect((await removedReplay.json()).code).toBe('HENKATEN_DELETED');
  await qualityPage.setViewportSize({ width: 1280, height: 900 });

  const invalidIpClient = await post<{
    client: { clientId: string };
    clientSecret: string;
  }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-clients`,
    { name: 'IP restricted', ipAllowlist: ['203.0.113.10'] },
    tmminCsrf,
  );
  const deniedIp = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/auth/token`,
    {
      data: {
        client_id: invalidIpClient.client.clientId,
        client_secret: invalidIpClient.clientSecret,
      },
    },
  );
  expect(deniedIp.status()).toBe(401);

  const rateClient = await post<{
    client: { clientId: string };
    clientSecret: string;
  }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-clients`,
    { name: 'Rate isolated', ipAllowlist: [] },
    tmminCsrf,
  );
  let rateLimited = false;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await tmminContext.request.post(
      `${runtime.apiOrigin}/api/v1/external/auth/token`,
      {
        data: { client_id: rateClient.client.clientId, client_secret: 'x'.repeat(32) },
      },
    );
    if (response.status() === 429) rateLimited = true;
  }
  expect(rateLimited).toBe(true);
  const isolatedClientToken = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/auth/token`,
    {
      data: { client_id: credential.client.clientId, client_secret: credential.clientSecret },
    },
  );
  expect(isolatedClientToken.status()).toBe(200);

  const rotated = await post<{
    client: { id: string; clientId: string; version: number };
    clientSecret: string;
  }>(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-clients/${credential.client.id}/rotate-secret`,
    { expectedVersion: credential.client.version },
    tmminCsrf,
  );
  const rotatedToken = await tmminContext.request.post(
    `${runtime.apiOrigin}/api/v1/external/auth/token`,
    {
      data: { client_id: rotated.client.clientId, client_secret: rotated.clientSecret },
    },
  );
  expect(rotatedToken.status()).toBe(200);
  const outstandingToken = ((await rotatedToken.json()) as { access_token: string }).access_token;
  await post(
    tmminContext.request,
    `/api/v1/tmmin/suppliers/${externalSupplier.supplier.id}/external-clients/${credential.client.id}/revoke`,
    { expectedVersion: rotated.client.version },
    tmminCsrf,
    200,
  );
  const revokedProbe = await tmminContext.request.get(
    `${runtime.apiOrigin}/api/v1/external/ingestions/external-open-1`,
    { headers: { Authorization: `Bearer ${outstandingToken}` } },
  );
  expect(revokedProbe.status()).toBe(401);

  await Promise.all([hosted.context.close(), qualityContext.close(), tmminContext.close()]);
});

type Session = { csrfToken: string };

type ExternalEvent = ReturnType<typeof externalEvent>;

function externalEvent(
  eventId: string,
  sourceHenkatenId: string,
  sourceVersion: number,
  eventType:
    | 'HENKATEN_OPENED'
    | 'HENKATEN_OPEN_UPDATED'
    | 'HENKATEN_APPROVED'
    | 'HENKATEN_REJECTED'
    | 'HENKATEN_CANCELLED',
) {
  return {
    schemaVersion: '1.0',
    eventId,
    sourceHenkatenId,
    sourceVersion,
    eventType,
    status: 'OPEN' as 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
    occurredAt: new Date().toISOString(),
    line: { externalId: 'LINE-EXT-01', name: 'External Line' },
    shift: {
      externalId: 'SHIFT-EXT-01',
      name: 'External Shift',
      businessDate: new Date().toISOString().slice(0, 10),
      timezone: 'Asia/Jakarta',
    },
    job: { externalId: 'JOB-EXT-01', name: 'External Job' },
    part: { number: 'PART-EXT-01', name: 'External Part' },
    changePoint: 'MACHINE',
    change: {
      affectedObject: 'Machine A',
      replacementObject: 'Machine B',
      cause: 'Controlled external change',
      detail: 'External integration evidence',
    },
    checklist: {
      templateVersion: 'machine-v1',
      allPassed: true,
      items: [
        {
          externalId: 'CHECK-EXT-01',
          label: 'External condition verified',
          answer: 'YES',
        },
      ],
    },
    decisions: [] as Array<Record<string, string>>,
    cancellationReason: undefined as string | undefined,
    metadata: { sourceSystem: 'e2e-external-system', sourceCorrelationId: `corr-${eventId}` },
  };
}

async function ingest(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  event: ExternalEvent,
  expectedStatus: number,
) {
  const response = await request.post(`${runtime.apiOrigin}/api/v1/external/henkaten/events`, {
    data: event,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(expectedStatus);
  return response.json() as Promise<{ status: string }>;
}
