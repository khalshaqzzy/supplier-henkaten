import { expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { createHostedFixture, loginBootstrapThroughApi, runtime, test } from './support.js';

test('imports a complete workbook, reviews responsive states and resets setup @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const tmmin = await browser.newContext();
  const csrf = await loginBootstrapThroughApi(tmmin.request);
  const fixture = await createHostedFixture(browser, tmmin.request, csrf, 'setup-import');
  const page = await fixture.context.newPage();
  await page.goto(`${runtime.supplierOrigin}/master-data`);
  await expect(page.getByRole('button', { name: 'Export Excel' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Import Data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Data', exact: true });
  await expect(dialog).toBeVisible();
  const template = await fixture.request.get(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/setup-import/template`,
  );
  expect(template.status()).toBe(200);
  const bytes = await template.body();
  await page.route('**/setup-import/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'setup.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bytes,
  });
  await expect(dialog.locator('[aria-busy=true]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('setup-loading.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: /Checklist 4M/ }).click();
  await dialog.getByRole('button', { name: 'Update semua', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeEnabled();
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`setup-review-${width}.png`),
      animations: 'disabled',
    });
  }
  const accessibility = await new AxeBuilder({ page }).include('[role=dialog]').analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Import data', exact: true }).click();
  await expect(dialog.getByText('Data berhasil diimport', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({
    path: testInfo.outputPath('setup-complete-mobile.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Selesai', exact: true }).click();
  await page.goto(`${runtime.supplierOrigin}/henkatens`);
  await expect(page.getByRole('button', { name: 'Export Excel' })).toBeVisible();
  await page.goto(`${runtime.supplierOrigin}/account`);
  await page.getByRole('button', { name: 'Reset setup', exact: true }).click();
  const reset = page.getByRole('dialog', { name: 'Reset setup supplier?' });
  await expect(reset.getByLabel('Password admin')).toBeVisible();
  await reset.getByLabel('Password admin').fill(fixture.admin.password);
  await page.screenshot({
    path: testInfo.outputPath('setup-reset-mobile.png'),
    animations: 'disabled',
  });
  expect((await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations).toEqual(
    [],
  );
  await reset.getByRole('button', { name: 'Reset setup', exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/);
  const summary = await fixture.request.get(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/setup-reset/preview`,
  );
  expect(summary.status()).toBe(200);
  expect((await summary.json()).empty).toBe(true);
  await fixture.context.close();
  await tmmin.close();
});
