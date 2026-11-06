import { writeFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
type ShiftTemplate = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  version: number;
};
type LineShift = {
  id: string;
  version: number;
  assignments: Array<{ mpMemberId: string | null }>;
  lineLeaderMemberId: string | null;
};
type TanokoMatrix = { members: Array<{ id: string; lineIds: string[] }> };
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

test('Supplier operations: searchable assignments, reviewed shift rotation, Tanoko scopes and unblocked Part deletion @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'operations');
  // Operational accounts are activated through their first login, as on the real setup flow.
  const supervisor = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.supervisor.credential!,
    'operations-sv',
  );
  const leader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.leader.credential!,
    'operations-ll',
  );
  await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.donorLeader.credential!,
    'operations-donor',
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/members/${fixture.members.mp.id}`,
    { expectedVersion: 1, fullName: 'Budi Santoso' },
    fixture.csrf,
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/members/${fixture.members.replacement.id}`,
    { expectedVersion: 1, fullName: 'Dewi Wulandari' },
    fixture.csrf,
  );
  const shiftsBase = '/api/v1/supplier/master-data/shift-templates';
  const morning = await get<ShiftTemplate>(
    fixture.request,
    `${shiftsBase}/${fixture.shiftTemplate.id}`,
  );
  const night = await post<ShiftTemplate>(
    fixture.request,
    shiftsBase,
    { name: 'Shift B', startTime: '18:00', endTime: '06:00', timezone: 'Asia/Jakarta' },
    fixture.csrf,
  );
  const configured = await post<LineShift>(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${fixture.line.id}/shifts`,
    { shiftTemplateId: morning.id },
    fixture.csrf,
  );
  const donor = await post<LineShift>(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${fixture.donorLine.id}/shifts`,
    { shiftTemplateId: night.id },
    fixture.csrf,
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/line-shifts/${donor.id}/assignments`,
    {
      expectedVersion: donor.version,
      supervisorMemberId: fixture.members.supervisor.id,
      lineLeaderMemberId: fixture.members.donorLeader.id,
      jobs: [{ jobId: fixture.donorJob.id, mpMemberId: fixture.members.replacement.id }],
    },
    fixture.csrf,
  );
  const page = await fixture.context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/master-data/line-setup?lineId=${fixture.line.id}`);
  const mpPicker = page.getByRole('button', { name: /MP · Job/ });
  await mpPicker.click();
  const search = page.getByRole('combobox', { name: /Cari MP/ });
  await search.fill('Tidak ada hasil');
  await expect(page.getByText('Member tidak ditemukan')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('assignment-search-empty.png') });
  await search.fill('Dewi');
  await search.press('Enter');
  await expect(mpPicker).toContainText('Dewi Wulandari');
  await page.getByRole('button', { name: /Supervisor / }).click();
  await page.getByRole('combobox', { name: 'Cari Supervisor' }).fill('REG-operations-1');
  await page.getByRole('combobox', { name: 'Cari Supervisor' }).press('Enter');
  await page.getByRole('button', { name: /Line Leader / }).click();
  await expect(page.getByRole('option', { name: /Ditugaskan di/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('combobox', { name: 'Cari Line Leader' }).fill('REG-operations-2');
  await page.getByRole('combobox', { name: 'Cari Line Leader' }).press('Enter');
  // Review the same assignment picker at desktop, tablet and narrow-phone widths.
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await mpPicker.click();
    await expect(page.getByRole('combobox', { name: /Cari MP/ })).toBeFocused();
    expect((await new AxeBuilder({ page }).include('.hds-popover').analyze()).violations).toEqual(
      [],
    );
    await page.screenshot({
      path: testInfo.outputPath(`assignment-search-${width}.png`),
      animations: 'disabled',
    });
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      nodes: Array.from(document.querySelectorAll('body *'))
        .map((element) => ({
          name: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((item) => item.right > innerWidth + 1 && item.width > 0)
        .slice(0, 16),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Simpan assignment' }).click();
  await expect(page.getByText('Assignment disimpan', { exact: true })).toBeVisible();
  const assigned = (
    await get<{ items: LineShift[] }>(
      fixture.request,
      `/api/v1/supplier/master-data/lines/${fixture.line.id}/shifts`,
    )
  ).items.find((item) => item.id === configured.id)!;
  expect(assigned.assignments[0]?.mpMemberId).toBe(fixture.members.replacement.id);
  await expect(page.getByText('Assignment disimpan', { exact: true })).not.toBeVisible({
    timeout: 10_000,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/master-data/shifts`);
  await page.getByRole('button', { name: 'Tukar waktu shift', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Tukar waktu shift', exact: true });
  await sheet.getByRole('combobox', { name: 'Shift pertama' }).click();
  await page.getByRole('option', { name: morning.name, exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Shift kedua' }).click();
  await page.getByRole('option', { name: night.name, exact: true }).click();
  await expect(sheet.getByText('2 line menggunakan shift ini')).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(sheet.getByRole('button', { name: 'Tukar waktu shift' })).toBeInViewport();
    const bounds = await sheet.boundingBox();
    expect(Math.round(bounds!.x + bounds!.width)).toBe(width);
    await expect(sheet.locator('.catalog-time-row').nth(1)).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.catalog-sheet').analyze()).violations).toEqual(
      [],
    );
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      nodes: Array.from(document.querySelectorAll('body *'))
        .map((element) => ({
          name: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((item) => item.right > innerWidth + 1 && item.width > 0)
        .slice(0, 16),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    if (width === 1440) {
      const snapshot = await page.evaluate(() => {
        const dialog = document.querySelector('.catalog-sheet')!.cloneNode(true) as HTMLElement;
        const css = Array.from(document.styleSheets)
          .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
          .join('\n');
        return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review waktu shift</title><style>${css}</style></head><body><main data-ui><h1 class="sr-only">Review waktu shift</h1>${dialog.outerHTML}</main></body></html>`;
      });
      writeFileSync(testInfo.outputPath('swap-ui-snapshot.html'), snapshot);
    }
    await page.screenshot({
      path: testInfo.outputPath(`swap-review-${width}.png`),
      animations: 'disabled',
    });
  }
  let lostSwap = true;
  await page.route('**/shift-templates/swap-times', async (route) => {
    if (lostSwap) {
      lostSwap = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await sheet.getByRole('button', { name: 'Tukar waktu shift' }).click();
  await sheet.getByRole('button', { name: 'Periksa & coba lagi' }).click();
  await expect(page.getByRole('dialog', { name: 'Waktu shift berhasil ditukar' })).toBeVisible();
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  const swapped = await get<ShiftTemplate>(fixture.request, `${shiftsBase}/${morning.id}`);
  expect([swapped.startTime, swapped.endTime, swapped.version]).toEqual(['18:00', '06:00', 2]);
  const after = (
    await get<{ items: LineShift[] }>(
      fixture.request,
      `/api/v1/supplier/master-data/lines/${fixture.line.id}/shifts`,
    )
  ).items.find((item) => item.id === configured.id)!;
  expect(after.assignments).toEqual(assigned.assignments);
  expect(after.lineLeaderMemberId).toBe(assigned.lineLeaderMemberId);
  // All Tanoko readers receive scoped membership without master-data read permission changes.
  const matrix = await get<TanokoMatrix>(supervisor.context.request, '/api/v1/supplier/tanoko');
  expect(matrix.members.find((m) => m.id === fixture.members.replacement.id)?.lineIds).toContain(
    fixture.line.id,
  );
  await page.goto(`${runtime.supplierOrigin}/tanoko`);
  await page.getByRole('combobox', { name: 'Filter line' }).selectOption(fixture.line.id);
  await page.getByRole('checkbox', { name: 'MP di line ini' }).check();
  await expect(page.getByText('Budi Santoso', { exact: true })).toHaveCount(0);
  await expect(page.locator('.tanoko-name').filter({ hasText: 'Dewi Wulandari' })).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      nodes: Array.from(document.querySelectorAll('body *'))
        .map((element) => ({
          name: element.tagName,
          class: element.className,
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((item) => item.right > innerWidth + 1 && item.width > 0)
        .slice(0, 16),
    }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    await page.screenshot({
      path: testInfo.outputPath(`tanoko-scopes-${width}.png`),
      animations: 'disabled',
    });
  }
  // Create an Open Henkaten referencing a Part, then delete the catalog without blocking it.
  const open = await post<{ id: string }>(
    leader.context.request,
    '/api/v1/supplier/henkatens',
    {
      category: 'MACHINE',
      jobId: fixture.job.id,
      partId: fixture.part.id,
      cause: 'Perubahan mesin',
      detail: 'Pemeriksaan pergantian mesin',
      affectedObject: 'Mesin A',
      replacementObject: 'Mesin B',
    },
    leader.csrf,
    201,
    crypto.randomUUID(),
  );
  await page.goto(`${runtime.supplierOrigin}/master-data/parts?search=not-matching`);
  await page.getByRole('button', { name: 'Hapus semua part', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Hapus semua part?' });
  await expect(deletion.locator('.catalog-delete-summary > strong')).toHaveText('1');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(deletion.getByRole('button', { name: 'Hapus semua part' })).toBeInViewport();
    expect(
      (await new AxeBuilder({ page }).include('.catalog-delete-dialog').analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`delete-review-${width}.png`),
      animations: 'disabled',
    });
  }
  let lostDelete = true;
  await page.route('**/parts/delete-all', async (route) => {
    if (lostDelete) {
      lostDelete = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await deletion.getByRole('button', { name: 'Hapus semua part' }).click();
  await deletion.getByRole('button', { name: 'Periksa & coba lagi' }).click();
  await expect(page.getByRole('dialog', { name: 'Part berhasil dihapus' })).toBeVisible();
  const detail = await get<{ status: string; part: { number: string } }>(
    fixture.request,
    `/api/v1/supplier/henkatens/${open.id}`,
  );
  expect(detail.status).toBe('OPEN');
  expect(detail.part.number).toBe('PART-operations');
  const listed = await get<{ items: unknown[] }>(
    fixture.request,
    '/api/v1/supplier/master-data/parts?active=ALL',
  );
  expect(listed.items).toHaveLength(0);
  await fixture.context.close();
  await leader.context.close();
  await supervisor.context.close();
  await root.close();
});
