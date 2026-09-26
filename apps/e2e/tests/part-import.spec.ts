import { expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { createHostedFixture, get, loginBootstrapThroughApi, runtime, test } from './support.js';

test('reviews CSV conflicts and imports an Excel workbook @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const tmmin = await browser.newContext();
  const csrf = await loginBootstrapThroughApi(tmmin.request);
  const fixture = await createHostedFixture(browser, tmmin.request, csrf, 'part-import');
  const page = await fixture.context.newPage();
  await page.goto(`${runtime.supplierOrigin}/master-data/parts/import`);
  await expect(page.getByRole('heading', { name: 'Import part' })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'parts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Part number,Nama part\r\nPART-part-import,"Updated, existing part"\r\nPART-NEW-1,New imported part\r\n',
    ),
  });
  await page.getByRole('button', { name: 'Review file' }).click();
  await expect(page.getByRole('heading', { name: '2 part dalam file' })).toBeVisible();
  await expect(page.getByText('Part part-import')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('part-import-review-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({
    path: testInfo.outputPath('part-import-review-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Keputusan PART-part-import').selectOption('UPDATE');
  await page.getByRole('button', { name: 'Simpan import' }).click();
  await expect(page.getByRole('heading', { name: 'Import selesai' })).toBeVisible();
  await expect(page.locator('.part-import-stats')).toContainText('1Ditambahkan');
  await expect(page.locator('.part-import-stats')).toContainText('1Diperbarui');
  const part = await get<{ partName: string }>(
    fixture.request,
    `/api/v1/supplier/master-data/parts/${fixture.part.id}`,
  );
  expect(part.partName).toBe('Updated, existing part');
  await page.getByRole('button', { name: 'Import file lain' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles(fileURLToPath(new URL('../fixtures/part-import.xlsx', import.meta.url)));
  await page.getByRole('button', { name: 'Review file' }).click();
  await expect(page.getByRole('heading', { name: '1 part dalam file' })).toBeVisible();
  await expect(page.getByText('123456789')).toBeVisible();
  await page.getByRole('button', { name: 'Simpan import' }).click();
  await expect(page.getByRole('heading', { name: 'Import selesai' })).toBeVisible();
  await expect(page.locator('.part-import-stats')).toContainText('1Ditambahkan');
  await fixture.context.close();
  await tmmin.close();
});
