import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import {
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  loginRole,
  post,
  runtime,
  test,
} from './support.js';

test('Tanoko freezes both axes, saves cross-line mapping and displays history @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const root = await browser.newContext();
  const csrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, csrf, 'tanoko');
  for (let i = 0; i < 18; i++) {
    await post(
      fixture.request,
      `/api/v1/supplier/master-data/lines/${fixture.line.id}/jobs`,
      {
        name: `Inspection process ${String(i + 1).padStart(2, '0')}`,
        skillCategory: ['HIGH', 'MEDIUM', 'LOW'][i % 3],
      },
      fixture.csrf,
    );
  }
  for (let i = 0; i < 12; i++) {
    await post(
      fixture.request,
      '/api/v1/supplier/master-data/members',
      {
        fullName: `Operator ${String(i + 1).padStart(2, '0')} Nama Panjang Untuk Clipping`,
        role: 'MP',
      },
      fixture.csrf,
    );
  }
  const supervisor = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.supervisor.credential!,
    'tanoko-supervisor',
  );
  const page = await supervisor.context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/tanoko`);
  await expect(page.getByRole('heading', { name: 'Tanoko', exact: true })).toBeVisible();
  await expect(page.locator('.tanoko-table tbody tr')).toHaveCount(20);
  await expect(page.locator('.tanoko-name').first()).not.toContainText('REG-');
  await page.screenshot({ path: testInfo.outputPath('tanoko-matrix-desktop.png') });
  const scroll = page.locator('.tanoko-table-scroll');
  const corner = page.locator('thead .freeze-job');
  const before = await corner.boundingBox();
  await scroll.evaluate((el) => {
    el.scrollLeft = 550;
    el.scrollTop = 350;
  });
  const after = await corner.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  const cell = page.locator('.tanoko-cell').first();
  await cell.click();
  await expect(page.getByRole('complementary', { name: /MP|Operator/ })).toBeVisible();
  await page.getByRole('radio', { name: /4 · Dapat melatih/ }).check();
  await page.getByLabel('Catatan perubahan').fill('Evaluasi praktik selesai.');
  await page.screenshot({ path: testInfo.outputPath('tanoko-editor-desktop.png') });
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByRole('status')).toContainText('Mapping tersimpan');
  await page.getByRole('button', { name: 'Tutup editor' }).click();
  await page.getByRole('tab', { name: 'Riwayat' }).click();
  await expect(page.getByText('Evaluasi praktik selesai.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tanoko-history-desktop.png') });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Riwayat' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Matriks' }).click();
  await expect(page.locator('.tanoko-cell').first()).toHaveAttribute('aria-label', /level 4/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (width < 1280)
      await expect
        .poll(() =>
          page.locator('.product-sidebar').evaluate((el) => el.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`tanoko-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 600 });
  await page.locator('.tanoko-cell').first().click();
  const inspectorBody = page.locator('.tanoko-inspector-body');
  const identity = page.locator('.tanoko-inspector-identity');
  const initialY = (await identity.boundingBox())!.y;
  await inspectorBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await identity.boundingBox())!.y).toBeLessThan(initialY);
  await expect(page.locator('.tanoko-inspector-footer')).toBeVisible();
  await page.getByRole('button', { name: 'Tutup editor' }).click();
  const matrix = await get<{
    members: { id: string }[];
    jobs: { id: string }[];
    mappings: { memberId: string; jobId: string; version: number; level: number | null }[];
  }>(fixture.request, '/api/v1/supplier/tanoko');
  const chosen = matrix.mappings.find(
    (m) => m.memberId === matrix.members[0]!.id && m.jobId === matrix.jobs[0]!.id,
  )!;
  const path = `${runtime.apiOrigin}/api/v1/supplier/tanoko/members/${chosen.memberId}/jobs/${chosen.jobId}`;
  const stale = await fixture.request.put(path, {
    headers: { Origin: runtime.supplierOrigin, 'X-CSRF-Token': fixture.csrf },
    data: { expectedVersion: null, level: 4 },
  });
  expect(stale.status()).toBe(409);
  const qc = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.qc.credential!,
    'tanoko-qc',
  );
  const forbidden = await qc.context.request.put(path, {
    headers: { Origin: runtime.supplierOrigin, 'X-CSRF-Token': qc.csrf },
    data: { expectedVersion: chosen.version, level: 4 },
  });
  expect(forbidden.status()).toBe(403);
  await Promise.all([
    root.close(),
    fixture.context.close(),
    supervisor.context.close(),
    qc.context.close(),
  ]);
});
