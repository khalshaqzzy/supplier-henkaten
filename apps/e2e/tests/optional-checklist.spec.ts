import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import {
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  loginRole,
  patch,
  post,
  runtime,
  test,
} from './support.js';

test('submits optional 4M evidence directly and preserves No and unanswered snapshots @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'optional');
  const lineShift = await post<{ id: string; version: number }>(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${fixture.line.id}/shifts`,
    { shiftTemplateId: fixture.shiftTemplate.id },
    fixture.csrf,
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/line-shifts/${lineShift.id}/assignments`,
    {
      expectedVersion: lineShift.version,
      supervisorMemberId: fixture.members.supervisor.id,
      lineLeaderMemberId: fixture.members.leader.id,
      jobs: [{ jobId: fixture.job.id, mpMemberId: fixture.members.mp.id }],
    },
    fixture.csrf,
  );
  const leader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.leader.credential!,
    'optional-leader',
  );
  const page = await leader.context.newPage();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  const draftPath = '/api/v1/supplier/master-data/checklists/METHOD';
  let draft = await get<{ version: number }>(fixture.request, `${draftPath}/draft`);
  await post(
    fixture.request,
    `${draftPath}/deactivate`,
    { expectedVersion: draft.version },
    fixture.csrf,
  );
  for (const state of ['absent', 'empty', 'unanswered', 'partial', 'mixed']) {
    if (state === 'empty') {
      draft = await get(fixture.request, `${draftPath}/draft`);
      await post(
        fixture.request,
        `${draftPath}/activate`,
        { expectedVersion: draft.version },
        fixture.csrf,
      );
      const saved = await patch<{ version: number }>(
        fixture.request,
        `${draftPath}/draft`,
        { items: [] },
        fixture.csrf,
      );
      const published = await post<{ items: unknown[] }>(
        fixture.request,
        `${draftPath}/publish`,
        { expectedVersion: saved.version },
        fixture.csrf,
      );
      expect(published.items).toEqual([]);
    }
    if (state === 'unanswered') {
      const saved = await patch<{ version: number }>(
        fixture.request,
        `${draftPath}/draft`,
        {
          items: [
            { label: 'First condition' },
            { label: 'Second condition' },
            { label: 'Third condition' },
          ],
        },
        fixture.csrf,
      );
      await post(
        fixture.request,
        `${draftPath}/publish`,
        { expectedVersion: saved.version },
        fixture.csrf,
      );
    }
    await page.goto(`${runtime.supplierOrigin}/henkatens/new`);
    await page.getByRole('radio', { name: 'Method', exact: true }).click();
    await page.getByLabel('Job', { exact: false }).selectOption(fixture.job.id);
    await page.getByLabel(/^Part/).selectOption('OTHER');
    await page.getByLabel('Objek terdampak').fill('Routine condition');
    await page.getByLabel('Kondisi baru').fill('Replacement condition');
    await page.getByLabel('Penyebab').fill('Routine replacement');
    await page.getByLabel('Detail kejadian').fill(`Optional checklist: ${state}`);
    if (state === 'partial' || state === 'mixed')
      await page.getByRole('button', { name: 'No', exact: true }).nth(0).click();
    if (state === 'mixed')
      await page.getByRole('button', { name: 'Yes', exact: true }).nth(1).click();
    if (state === 'mixed') {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath(`optional-form-${width}.png`),
          fullPage: true,
        });
      }
    }
    await expect(page.getByRole('button', { name: 'Submit Henkaten' })).toBeEnabled();
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/supplier/henkatens'),
    );
    await page.getByRole('button', { name: 'Submit Henkaten' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const created = (await response.json()) as {
      id: string;
      identifier: string;
      checklist: { answers: { answer: string | null }[] } | null;
    };
    expect(dialogs).toBe(0);
    if (state === 'absent') expect(created.checklist).toBeNull();
    else
      expect(
        created.checklist?.answers.map((answer: { answer: string | null }) => answer.answer),
      ).toEqual(
        state === 'empty'
          ? []
          : state === 'unanswered'
            ? [null, null, null]
            : state === 'partial'
              ? ['NO', null, null]
              : ['NO', 'YES', null],
      );
    await page.goto(`${runtime.supplierOrigin}/henkatens/${created.id}`);
    await expect(
      page.getByRole('heading', { name: created.identifier, exact: true }),
    ).toBeVisible();
    if (state === 'mixed') {
      await expect(page.getByText('Belum dijawab', { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('optional-detail-mobile.png'),
        fullPage: true,
      });
    }
    if (state === 'absent') {
      await page.goto(`${runtime.supplierOrigin}/henkatens/${created.id}/clone`);
      await expect(page.getByRole('heading', { name: 'Clone Henkaten' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit Henkaten' })).toBeEnabled();
    }
  }
  // A retained active occurrence must not prevent disabling a supplement.
  draft = await get(fixture.request, `${draftPath}/draft`);
  await post(
    fixture.request,
    `${draftPath}/deactivate`,
    { expectedVersion: draft.version },
    fixture.csrf,
  );
  await Promise.all([leader.context.close(), fixture.context.close(), root.close()]);
});
