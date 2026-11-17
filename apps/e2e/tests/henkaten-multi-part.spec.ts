import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import {
  chooseOption,
  createHostedFixture,
  loginBootstrapThroughApi,
  loginRole,
  patch,
  post,
  runtime,
  test,
} from './support.js';

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Line Leader submits one Henkaten for several parts', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'multipart');
  const extraParts = [];
  for (const [number, name] of [
    ['MP-53601-A', 'Bracket assy front'],
    ['MP-53602-B', 'Bracket assy rear'],
    ['MP-61023-C', 'Hinge door upper'],
  ] as const) {
    extraParts.push(
      await post<{ id: string }>(
        fixture.request,
        '/api/v1/supplier/master-data/parts',
        { partNumber: number, partName: name },
        fixture.csrf,
      ),
    );
  }
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
      lineLeaderMemberIds: [fixture.members.leader.id],
      jobs: [{ jobId: fixture.job.id, mpMemberId: fixture.members.mp.id }],
    },
    fixture.csrf,
  );
  const leader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.leader.credential!,
    'multipart-leader',
  );
  const page = await leader.context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`${runtime.supplierOrigin}/henkatens/new`);
  await page.getByRole('radio', { name: 'Method', exact: true }).click();
  await chooseOption(page.getByLabel('Job', { exact: false }), fixture.job.id);

  // The list stays open while several parts are picked, and the search runs on the server.
  const trigger = page.getByLabel(/^Part/);
  await trigger.click();
  const list = page.locator('.part-picker__popup [role="listbox"]');
  await expect(list).toBeVisible();
  await page.getByRole('combobox', { name: 'Cari part' }).fill('MP-');
  await expect(list.getByRole('option')).toHaveCount(3);
  await list.locator(`[data-value="${extraParts[1]!.id}"]`).click();
  await list.locator(`[data-value="${extraParts[0]!.id}"]`).click();
  await expect(list.locator(`[data-value="${extraParts[0]!.id}"]`)).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({
    path: testInfo.outputPath('part-picker-open-1440.png'),
    animations: 'disabled',
  });
  // A selection survives a different search and keyboard selection works from the search box.
  await page.getByRole('combobox', { name: 'Cari part' }).fill('Hinge');
  await expect(list.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(list).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText('3 part dipilih');
  const chosen = page.getByRole('list', { name: 'Pilihan part' });
  await expect(chosen.getByRole('listitem')).toHaveCount(3);

  // Removing one chip and re-adding it keeps the order in which parts were chosen.
  await page.getByRole('button', { name: 'Hapus pilihan part MP-53601-A' }).click();
  await expect(chosen.getByRole('listitem')).toHaveCount(2);
  await trigger.click();
  await list.locator(`[data-value="${extraParts[0]!.id}"]`).click();
  await page.keyboard.press('Escape');
  await expect(chosen.getByRole('listitem')).toHaveCount(3);

  await page.getByLabel('Objek terdampak').fill('Urutan pengencangan lama');
  await page.getByLabel('Kondisi baru').fill('Urutan pengencangan baru');
  await page.getByLabel('Penyebab').fill('Perubahan metode kerja');
  await page.getByLabel('Detail kejadian').fill('Berlaku untuk seluruh part yang dipilih.');
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`henkaten-form-multi-part-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await trigger.click();
  await expect(list).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('part-picker-open-320.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(
    (
      await new AxeBuilder({ page })
        .include('.henkaten-form')
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);

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
    partId: string;
    parts: Array<{ id: string; number: string }>;
  };
  expect(created.parts.map(({ number }) => number)).toEqual([
    'MP-53602-B',
    'MP-61023-C',
    'MP-53601-A',
  ]);
  expect(created.partId).toBe(extraParts[1]!.id);

  // The record lists every part; the compact list shows the first part and the remaining count.
  await page.goto(`${runtime.supplierOrigin}/henkatens/${created.id}`);
  await expect(page.getByText('Part terdampak (3)')).toBeVisible();
  await expect(page.locator('.henkaten-parts-list li')).toHaveCount(3);
  await expect(page.locator('.henkaten-parts-list')).toContainText('MP-61023-C');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`henkaten-detail-multi-part-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/henkatens?part=MP-53601-A`);
  const row = page.getByRole('row').filter({ hasText: 'MP-53602-B' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.part-summary__more')).toHaveText('+2');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`henkaten-list-multi-part-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }

  // A part of an Open multi-part Henkaten cannot be deactivated, whichever position it has.
  const third = await fixture.request.get(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/parts/${extraParts[0]!.id}`,
  );
  const { version } = (await third.json()) as { version: number };
  const deactivate = await fixture.request.post(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/parts/${extraParts[0]!.id}/deactivate`,
    {
      headers: { Origin: runtime.supplierOrigin, 'X-CSRF-Token': fixture.csrf },
      data: { expectedVersion: version },
    },
  );
  expect(deactivate.status()).toBe(409);
  await Promise.all([leader.context.close(), fixture.context.close(), root.close()]);
});
