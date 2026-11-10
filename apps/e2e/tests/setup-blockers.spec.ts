import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import {
  createHostedFixture,
  loginBootstrapThroughApi,
  patch,
  post,
  runtime,
  test,
} from './support.js';

type LineShift = {
  id: string;
  version: number;
  assignments: Array<{ jobId: string; mpMemberId: string | null }>;
};

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
}

async function settleAnimations(page: Page) {
  // A resize can cancel a running transition; its `finished` promise then rejects with AbortError,
  // and a replacement transition may start, so wait until no finite animation is still running.
  await page.evaluate(async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const running = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getTiming().iterations !== Infinity,
        );
      if (running.length === 0) return;
      await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
    }
  });
}

async function expectHighlighted(page: Page, selector: string) {
  const target = page.locator(selector);
  await expect(target).toHaveClass(/is-focus-target/);
  await expect(target).toBeInViewport();
  expect(await target.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(page).not.toHaveURL(/focus=/);
}

test('Setup blockers expand into named entities and deep-link to the exact fix @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'blockers');
  const { request, csrf } = fixture;
  const base = '/api/v1/supplier/master-data';

  const secondJob = await post<{ id: string }>(
    request,
    `${base}/lines/${fixture.line.id}/jobs`,
    { name: 'Final Inspection' },
    csrf,
  );
  const thirdLine = await post<{ id: string }>(
    request,
    `${base}/lines`,
    { code: 'LINE-blockers-C', name: 'Line blockers C' },
    csrf,
  );
  // Line A: Line Leader and the first MP are staffed; Supervisor and the second MP are open.
  const lineShift = await post<LineShift>(
    request,
    `${base}/lines/${fixture.line.id}/shifts`,
    { shiftTemplateId: fixture.shiftTemplate.id },
    csrf,
  );
  await patch(
    request,
    `${base}/line-shifts/${lineShift.id}/assignments`,
    {
      expectedVersion: lineShift.version,
      supervisorMemberId: null,
      lineLeaderMemberId: fixture.members.leader.id,
      jobs: lineShift.assignments.map(({ jobId }) => ({
        jobId,
        mpMemberId: jobId === fixture.job.id ? fixture.members.mp.id : null,
      })),
    },
    csrf,
  );
  // Line B owns only an inactive shift; Line C has none.
  const donorShift = await post<LineShift>(
    request,
    `${base}/lines/${fixture.donorLine.id}/shifts`,
    { shiftTemplateId: fixture.shiftTemplate.id },
    csrf,
  );
  const deactivate = await request.post(
    `${runtime.apiOrigin}${base}/line-shifts/${donorShift.id}/deactivate`,
    {
      data: { expectedVersion: donorShift.version },
      headers: { Origin: runtime.supplierOrigin, 'X-CSRF-Token': csrf },
    },
  );
  expect(deactivate.ok()).toBe(true);

  const page = await fixture.context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/setup`);
  const panel = page.getByRole('region', { name: /Perlu diselesaikan/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('4 blocker · 1 area')).toBeVisible();

  // The first issue opens by default and names each line with its corrective action.
  const shiftIssue = page.getByRole('button', { name: /Line belum memiliki shift aktif/ });
  await expect(shiftIssue).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('link', { name: 'Tambah shift: LINE-blockers-C · Line blockers C' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Aktifkan shift: LINE-blockers-B · Line blockers B' }),
  ).toBeVisible();

  const mpIssue = page.getByRole('button', { name: /MP belum lengkap/ });
  await mpIssue.click();
  await expect(mpIssue).toHaveAttribute('aria-expanded', 'true');
  const mpRegion = page.getByRole('region', { name: /MP belum lengkap/ });
  await expect(mpRegion.getByText('LINE-blockers-A · Line blockers A')).toBeVisible();
  await expect(mpRegion.getByText('Final Inspection')).toBeVisible();
  await expect(mpRegion.getByText('Job blockers A')).toHaveCount(0);
  await page.getByRole('button', { name: /Supervisor belum lengkap/ }).click();
  await expect(page).toHaveURL(/open=/);

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await settleAnimations(page);
    await expectNoHorizontalOverflow(page);
    expect(
      (await new AxeBuilder({ page }).include('.setup-workspace').analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`setup-blockers-${width}.png`),
      animations: 'disabled',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // MP gap → Line Setup with the line, shift and job row selected and highlighted.
  await mpRegion
    .getByRole('link', {
      name: /Tetapkan MP: LINE-blockers-A · Line blockers A · .* · Final Inspection/,
    })
    .click();
  await expect(page.getByRole('heading', { name: 'Line Setup' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`lineShiftId=${lineShift.id}`));
  await expectHighlighted(page, `[data-focus-target="job:${secondJob.id}"]`);
  await page.screenshot({ path: testInfo.outputPath('line-setup-job-target.png') });
  await page.keyboard.press('Enter');
  const mpSearch = page.getByRole('combobox', { name: 'Cari MP · Final Inspection' });
  await expect(mpSearch).toBeFocused();
  await mpSearch.fill('MP');
  await mpSearch.press('Enter');
  await page.getByRole('button', { name: 'Simpan assignment' }).click();
  await expect(page.getByText('Assignment disimpan')).toBeVisible();

  // Back restores the expanded issues and the resolved MP issue disappears.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Setup Supplier' })).toBeVisible();
  await expect(page.getByRole('button', { name: /MP belum lengkap/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Supervisor belum lengkap/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByText('3 blocker · 1 area')).toBeVisible();

  // Supervisor gap → Supervisor picker focused.
  await page.getByRole('link', { name: /Tetapkan Supervisor: LINE-blockers-A/ }).click();
  await expectHighlighted(page, '[data-focus-target="supervisor"]');

  // Missing shift → new-shift control focused on the correct line.
  await page.goto(`${runtime.supplierOrigin}/setup`);
  await page.getByRole('link', { name: 'Tambah shift: LINE-blockers-C · Line blockers C' }).click();
  await expect(page).toHaveURL(new RegExp(`lineId=${thirdLine.id}`));
  await expectHighlighted(page, '[data-focus-target="add-shift"]');
  await expect(page.getByLabel('Shift baru')).toBeFocused();

  // Inactive shift → its status control on Line B.
  await page.goto(`${runtime.supplierOrigin}/setup`);
  await page
    .getByRole('link', { name: 'Aktifkan shift: LINE-blockers-B · Line blockers B' })
    .click();
  await expectHighlighted(page, '[data-focus-target="shift-status"]');
  await expect(page.getByRole('button', { name: 'Aktifkan shift' })).toBeFocused();

  // Detail-page destinations used by account, restoration and job actions.
  await page.goto(
    `${runtime.supplierOrigin}/master-data/members/${fixture.members.supervisor.id}?focus=account`,
  );
  await expectHighlighted(page, '[data-focus-target="account"]');
  await page.goto(`${runtime.supplierOrigin}/master-data/lines/${thirdLine.id}?focus=jobs`);
  await expectHighlighted(page, '[data-focus-target="jobs"]');
  await expect(page.getByPlaceholder('Nama job baru')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('line-jobs-target.png') });

  for (const width of [390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${runtime.supplierOrigin}/setup`);
    await page.getByRole('button', { name: /Supervisor belum lengkap/ }).click();
    await page.getByRole('link', { name: /Tetapkan Supervisor: LINE-blockers-A/ }).click();
    await expectHighlighted(page, '[data-focus-target="supervisor"]');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`line-setup-supervisor-${width}.png`) });
  }
});
