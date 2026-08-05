import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

import {
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  loginRole,
  post,
  realmOriginHeader,
  runtime,
  test,
} from './support.js';

test('proves shift, four-4M, approval, rejection, clone, warning and realtime behavior', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const tmminContext = await browser.newContext();
  const tmminCsrf = await loginBootstrapThroughApi(tmminContext.request);
  const fixture = await createHostedFixture(browser, tmminContext.request, tmminCsrf, 'lifecycle');
  const leaderCredential = fixture.members.leader.credential!;
  const supervisorCredential = fixture.members.supervisor.credential!;
  const qcCredential = fixture.members.qc.credential!;
  expect(leaderCredential).toBeTruthy();
  expect(supervisorCredential).toBeTruthy();
  expect(qcCredential).toBeTruthy();

  const leader = await loginRole(
    browser,
    fixture.supplier.code,
    leaderCredential,
    'lifecycle-leader',
  );
  const supervisor = await loginRole(
    browser,
    fixture.supplier.code,
    supervisorCredential,
    'lifecycle-supervisor',
  );
  const overrideLeaderMember = await post<{
    member: { id: string };
    credential: { username: string; temporaryPassword: string };
  }>(
    fixture.request,
    '/api/v1/supplier/master-data/members',
    {
      fullName: 'Override Line Leader',
      registrationNumber: 'REG-LIFECYCLE-OVERRIDE',
      role: 'LINE_LEADER',
      username: 'override.leader.lifecycle',
    },
    fixture.csrf,
  );
  const overrideLeader = await loginRole(
    browser,
    fixture.supplier.code,
    overrideLeaderMember.credential,
    'lifecycle-override-leader',
  );
  const qc = await loginRole(browser, fixture.supplier.code, qcCredential, 'lifecycle-qc');
  const businessDate = new Date().toISOString().slice(0, 10);
  const prepared = await post<Shift>(
    leader.context.request,
    '/api/v1/supplier/shifts/preflight',
    {
      lineId: fixture.line.id,
      shiftTemplateId: fixture.shiftTemplate.id,
      businessDate,
    },
    leader.csrf,
  );
  expect(prepared.eligible).toBe(true);
  const active = await post<Shift>(
    leader.context.request,
    `/api/v1/supplier/shifts/${prepared.id}/start`,
    { expectedVersion: prepared.version },
    leader.csrf,
    201,
    'e2e-start-lifecycle',
  );
  expect(active.status).toBe('ACTIVE');
  await captureSupplierPage(
    fixture.context,
    `${runtime.supplierOrigin}/master-data/default-assignments?lineId=${fixture.line.id}`,
    'default-assignments',
    testInfo,
  );
  await captureSupplierPage(
    leader.context,
    `${runtime.supplierOrigin}/henkatens/new?shiftRunId=${active.id}&jobId=${fixture.job.id}`,
    'create-henkaten',
    testInfo,
  );
  const createHenkatenPage = await leader.context.newPage();
  await createHenkatenPage.goto(`${runtime.supplierOrigin}/henkatens/new`);
  await expectCategoryDots(createHenkatenPage);
  await expect(
    createHenkatenPage.getByRole('region', { name: 'Konteks Shift untuk Henkaten' }),
  ).toBeVisible();
  await expect(
    createHenkatenPage.getByRole('status', { name: 'Shift Run read-only' }),
  ).toContainText('Shift lifecycle');
  await expect(
    createHenkatenPage.getByLabel('Target job').locator(`option[value="${fixture.job.id}"]`),
  ).toHaveCount(1);
  await createHenkatenPage.close();

  const blockedLine = await post<{ id: string }>(
    fixture.request,
    '/api/v1/supplier/master-data/lines',
    { code: 'LINE-lifecycle-override', name: 'Override evidence line' },
    fixture.csrf,
  );
  await post(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${blockedLine.id}/jobs`,
    { name: 'Vacant override job' },
    fixture.csrf,
  );
  await post(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${blockedLine.id}/default-supervisor`,
    { memberId: fixture.members.supervisor.id },
    fixture.csrf,
  );
  await post(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${blockedLine.id}/default-line-leader`,
    { memberId: overrideLeaderMember.member.id },
    fixture.csrf,
  );
  const blockedPlan = await post<Shift>(
    overrideLeader.context.request,
    '/api/v1/supplier/shifts/preflight',
    {
      lineId: blockedLine.id,
      shiftTemplateId: fixture.shiftTemplate.id,
      businessDate,
    },
    overrideLeader.csrf,
  );
  expect(blockedPlan.eligible).toBe(false);
  const blockedStart = await overrideLeader.context.request.post(
    `${runtime.apiOrigin}/api/v1/supplier/shifts/${blockedPlan.id}/start`,
    {
      data: { expectedVersion: blockedPlan.version },
      headers: {
        ...realmOriginHeader('/api/v1/supplier/shifts'),
        'X-CSRF-Token': overrideLeader.csrf,
      },
    },
  );
  expect(blockedStart.status()).toBe(409);
  expect((await blockedStart.json()).code).toBe('STATE_CONFLICT');
  await captureSupplierPage(
    fixture.context,
    `${runtime.supplierOrigin}/shifts/${blockedPlan.id}`,
    'blocked-shift',
    testInfo,
  );
  const overridden = await post<Shift>(
    fixture.request,
    `/api/v1/supplier/shifts/${blockedPlan.id}/emergency-start`,
    {
      expectedVersion: blockedPlan.version,
      reason: 'Controlled continuity override for browser evidence.',
    },
    fixture.csrf,
  );
  expect(overridden.startedWithOverride).toBe(true);

  const boardPage = await leader.context.newPage();
  await boardPage.goto(`${runtime.supplierOrigin}/board`);
  await expect(boardPage.getByText('Live')).toBeVisible();
  await expect(boardPage.getByText('Open Henkaten').locator('..').getByText('0')).toBeVisible();
  await captureSupplierVisuals(boardPage, 'assignment-board', testInfo);

  const invalid = await leader.context.request.post(
    `${runtime.apiOrigin}/api/v1/supplier/henkatens`,
    {
      data: henkatenBody(fixture, active, 'MACHINE', 'NO'),
      headers: {
        ...realmOriginHeader('/api/v1/supplier/henkatens'),
        'X-CSRF-Token': leader.csrf,
        'Idempotency-Key': 'e2e-invalid-checklist',
      },
    },
  );
  expect(invalid.status()).toBe(409);
  expect((await invalid.json()).code).toBe('CHECKLIST_NOT_PUBLISHED');

  const machine = await createHenkaten(fixture, active, leader, 'MACHINE', 'machine-open');
  await expect
    .poll(
      async () =>
        Number(
          await boardPage.getByText('Open Henkaten').locator('..').locator('strong').innerText(),
        ),
      { timeout: 5_000 },
    )
    .toBe(1);
  const machineIndicator = boardPage.locator('.four-m .hds-4m-dot--machine');
  await expect(machineIndicator).toHaveCount(1);
  await expect(machineIndicator).toHaveCSS('background-color', 'rgb(47, 111, 237)');
  const indicatorLink = boardPage.locator('.four-m');
  await expect(indicatorLink).toHaveCount(1);
  expect(await indicatorLink.evaluate((element) => element.getBoundingClientRect().width)).toBe(28);
  await captureSupplierVisuals(boardPage, 'assignment-board-indicator', testInfo);
  await captureSupplierPage(
    fixture.context,
    `${runtime.supplierOrigin}/`,
    'supplier-overview',
    testInfo,
  );
  const warnings = await get<{ items: Array<{ supplierId: string; openWarningCount: number }> }>(
    tmminContext.request,
    '/api/v1/tmmin/warnings/affected-parts',
  );
  expect(warnings.items).toContainEqual(
    expect.objectContaining({ supplierId: fixture.supplier.id, openWarningCount: 1 }),
  );

  const supervisorApproved = await post<Henkaten>(
    supervisor.context.request,
    `/api/v1/supplier/henkatens/${machine.id}/decisions`,
    { expectedVersion: machine.version, decision: 'APPROVED', comment: 'Supervisor approved' },
    supervisor.csrf,
    201,
    'e2e-machine-supervisor',
  );
  expect(supervisorApproved.status).toBe('OPEN');
  await captureSupplierPage(
    qc.context,
    `${runtime.supplierOrigin}/henkatens/${machine.id}`,
    'henkaten-detail-approval',
    testInfo,
  );
  const fullyApproved = await post<Henkaten>(
    qc.context.request,
    `/api/v1/supplier/henkatens/${machine.id}/decisions`,
    { expectedVersion: supervisorApproved.version, decision: 'APPROVED', comment: 'QC approved' },
    qc.csrf,
    201,
    'e2e-machine-qc',
  );
  expect(fullyApproved.status).toBe('APPROVED');

  const material = await createHenkaten(fixture, active, leader, 'MATERIAL', 'material-open');
  const qcFirst = await post<Henkaten>(
    qc.context.request,
    `/api/v1/supplier/henkatens/${material.id}/decisions`,
    { expectedVersion: material.version, decision: 'APPROVED', comment: 'QC first' },
    qc.csrf,
    201,
    'e2e-material-qc',
  );
  const materialApproved = await post<Henkaten>(
    supervisor.context.request,
    `/api/v1/supplier/henkatens/${material.id}/decisions`,
    { expectedVersion: qcFirst.version, decision: 'APPROVED', comment: 'Supervisor second' },
    supervisor.csrf,
    201,
    'e2e-material-supervisor',
  );
  expect(materialApproved.status).toBe('APPROVED');

  const method = await createHenkaten(fixture, active, leader, 'METHOD', 'method-open');
  const rejected = await post<Henkaten>(
    supervisor.context.request,
    `/api/v1/supplier/henkatens/${method.id}/decisions`,
    { expectedVersion: method.version, decision: 'REJECTED', comment: 'Reject fast evidence' },
    supervisor.csrf,
    201,
    'e2e-method-reject',
  );
  expect(rejected.status).toBe('REJECTED');
  expect(rejected.routes.qc.status).toBe('NOT_REQUIRED');

  const qcRejectSource = await createHenkaten(
    fixture,
    active,
    leader,
    'MATERIAL',
    'qc-reject-open',
  );
  const qcRejected = await post<Henkaten>(
    qc.context.request,
    `/api/v1/supplier/henkatens/${qcRejectSource.id}/decisions`,
    { expectedVersion: qcRejectSource.version, decision: 'REJECTED', comment: 'QC reject fast' },
    qc.csrf,
    201,
    'e2e-qc-reject',
  );
  expect(qcRejected.status).toBe('REJECTED');
  expect(qcRejected.routes.supervisor.status).toBe('NOT_REQUIRED');

  const stale = await createHenkaten(fixture, active, leader, 'MACHINE', 'stale-open');
  const staleBodies = [1, 2].map((sequence) =>
    supervisor.context.request.post(
      `${runtime.apiOrigin}/api/v1/supplier/henkatens/${stale.id}/decisions`,
      {
        data: {
          expectedVersion: stale.version,
          decision: 'APPROVED',
          comment: `Concurrent decision ${sequence}`,
        },
        headers: {
          ...realmOriginHeader('/api/v1/supplier/henkatens'),
          'X-CSRF-Token': supervisor.csrf,
          'Idempotency-Key': `e2e-stale-${sequence}`,
        },
      },
    ),
  );
  const staleStatuses = (await Promise.all(staleBodies))
    .map((response) => response.status())
    .sort();
  expect(staleStatuses).toEqual([201, 409]);

  const cloneSource = await createHenkaten(fixture, active, leader, 'MACHINE', 'clone-source');
  const cancelled = await post<Henkaten>(
    leader.context.request,
    `/api/v1/supplier/henkatens/${cloneSource.id}/withdraw`,
    { expectedVersion: cloneSource.version, reason: 'Correction required' },
    leader.csrf,
    201,
    'e2e-withdraw',
  );
  expect(cancelled.status).toBe('CANCELLED');
  const prefill = await get<{
    clonedFromHenkatenId: string;
    shiftRunId: string;
    jobId: string;
    partId: string;
    checklistVersionId: string;
    checklistItems: Array<{ itemId: string }>;
  }>(leader.context.request, `/api/v1/supplier/henkatens/${cloneSource.id}/clone-prefill`);
  const clone = await post<Henkaten>(
    leader.context.request,
    '/api/v1/supplier/henkatens',
    {
      category: 'MACHINE',
      shiftRunId: prefill.shiftRunId,
      jobId: prefill.jobId,
      partId: prefill.partId,
      checklistVersionId: prefill.checklistVersionId,
      checklistAnswers: prefill.checklistItems.map(({ itemId }) => ({ itemId, answer: 'YES' })),
      cause: 'Corrected machine cause',
      detail: 'Corrected machine detail',
      affectedObject: 'Machine A',
      replacementObject: 'Machine C',
      clonedFromHenkatenId: prefill.clonedFromHenkatenId,
    },
    leader.csrf,
    201,
    'e2e-clone',
  );
  expect(clone.clonedFromHenkatenId).toBe(cloneSource.id);

  const current = await get<Shift>(leader.context.request, `/api/v1/supplier/shifts/${active.id}`);
  const ended = await post<Shift>(
    leader.context.request,
    `/api/v1/supplier/shifts/${active.id}/end`,
    { expectedVersion: current.version },
    leader.csrf,
    201,
    'e2e-end-shift',
  );
  expect(ended.status).toBe('ENDED');
  expect(ended.endSummary?.cancelledHenkatens).toBeGreaterThanOrEqual(1);

  const warningAfter = await get<{ items: Array<{ supplierId: string }> }>(
    tmminContext.request,
    '/api/v1/tmmin/warnings/affected-parts',
  );
  expect(warningAfter.items.some((item) => item.supplierId === fixture.supplier.id)).toBe(false);

  await leader.context.route('**/api/v1/supplier/realtime**', (route) => route.abort());
  const disconnectedBoard = await leader.context.newPage();
  await disconnectedBoard.goto(`${runtime.supplierOrigin}/board`);
  await expect(disconnectedBoard.getByText('Data mungkin stale')).toBeVisible();
  await expect(disconnectedBoard.getByRole('button', { name: 'Sambungkan ulang' })).toBeVisible();
  await disconnectedBoard.close();
  await leader.context.unroute('**/api/v1/supplier/realtime**');

  await Promise.all([
    fixture.context.close(),
    leader.context.close(),
    overrideLeader.context.close(),
    supervisor.context.close(),
    qc.context.close(),
    tmminContext.close(),
  ]);
});

async function expectCategoryDots(page: Page) {
  const expected = [
    ['man', 'rgb(220, 38, 38)'],
    ['machine', 'rgb(47, 111, 237)'],
    ['material', 'rgb(217, 119, 6)'],
    ['method', 'rgb(22, 163, 74)'],
  ] as const;

  for (const [category, color] of expected) {
    const dot = page.locator(`.category-picker .hds-4m-dot--${category}`);
    await expect(dot).toHaveCount(1);
    await expect(dot).toHaveCSS('background-color', color);
  }
}

type Shift = {
  id: string;
  status: string;
  eligible: boolean;
  startedWithOverride: boolean;
  version: number;
  workingAssignments: Array<{ id: string; jobId: string; version: number }>;
  endSummary?: { cancelledHenkatens: number } | null;
};

type Henkaten = {
  id: string;
  status: string;
  version: number;
  clonedFromHenkatenId?: string | null;
  routes: { supervisor: { status: string }; qc: { status: string } };
};

function henkatenBody(
  fixture: Awaited<ReturnType<typeof createHostedFixture>>,
  shift: Shift,
  category: 'MACHINE' | 'MATERIAL' | 'METHOD',
  answer: 'YES' | 'NO' = 'YES',
) {
  const checklist = fixture.checklists[category]!;
  return {
    category,
    shiftRunId: shift.id,
    jobId: fixture.job.id,
    partId: fixture.part.id,
    checklistVersionId: checklist.id,
    checklistAnswers: [{ itemId: checklist.itemId, answer }],
    cause: `${category} controlled change`,
    detail: `${category} detailed evidence`,
    affectedObject: `${category} A`,
    replacementObject: `${category} B`,
  };
}

function createHenkaten(
  fixture: Awaited<ReturnType<typeof createHostedFixture>>,
  shift: Shift,
  leader: Awaited<ReturnType<typeof loginRole>>,
  category: 'MACHINE' | 'MATERIAL' | 'METHOD',
  key: string,
) {
  return post<Henkaten>(
    leader.context.request,
    '/api/v1/supplier/henkatens',
    henkatenBody(fixture, shift, category),
    leader.csrf,
    201,
    `e2e-${key}`,
  );
}

async function captureSupplierPage(
  context: Awaited<ReturnType<typeof loginRole>>['context'],
  url: string,
  slug: string,
  testInfo: TestInfo,
) {
  if (process.env.E2E_VISUAL_CAPTURE !== '1' && slug !== 'supplier-overview') return;
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator('h1')).toBeVisible();
  if (slug === 'supplier-overview') {
    const chart = page.locator('.overview-widget--trend .recharts-wrapper');
    await expect(chart).toBeVisible();
    const chartBox = await chart.boundingBox();
    expect(chartBox?.width ?? 0).toBeGreaterThan(400);
    expect(chartBox?.height ?? 0).toBeGreaterThan(150);
    expect(
      await page.locator('.overview-widget--trend .recharts-line-dot').count(),
    ).toBeGreaterThan(0);
    expect(await page.locator('#overview-recent-activity > li').count()).toBeLessThanOrEqual(5);
  }
  await captureSupplierVisuals(page, slug, testInfo);
  await page.close();
}

async function captureSupplierVisuals(page: Page, slug: string, testInfo: TestInfo) {
  if (process.env.E2E_VISUAL_CAPTURE !== '1' && slug !== 'supplier-overview') return;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1672, height: 941 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate((viewportWidth) => {
      const scrollWidth = document.documentElement.scrollWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[
              ...element.classList,
            ]
              .map((name) => `.${name}`)
              .join('')}`,
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
          };
        })
        .filter(({ left, right }) => left < -0.5 || right > viewportWidth + 0.5)
        .slice(0, 10);
      return { scrollWidth, offenders };
    }, viewport.width);
    expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(
      viewport.width,
    );
    const menu = page.getByRole('button', { name: 'Buka navigasi' });
    if (viewport.width < 1280) {
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(menuBox?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(menuBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    } else {
      await expect(menu).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`${slug}-${viewport.width}x${viewport.height}.png`),
      animations: 'disabled',
      fullPage: false,
    });
    if (slug === 'supplier-overview') {
      const activity = page.locator('.overview-widget--activity');
      const grid = page.locator('.overview-grid');
      await activity.scrollIntoViewIfNeeded();
      const [activityBox, gridBox] = await Promise.all([
        activity.boundingBox(),
        grid.boundingBox(),
      ]);
      expect(Math.abs((activityBox?.width ?? 0) - (gridBox?.width ?? 0))).toBeLessThanOrEqual(2);
      await activity.screenshot({
        path: testInfo.outputPath(`${slug}-activity-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    }
    if (slug === 'supplier-overview') {
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}
