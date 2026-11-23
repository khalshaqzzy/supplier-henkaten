import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  chooseOption,
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  loginRole,
  patch,
  post,
  runtime,
  test,
} from './support.js';

const widths = [1440, 1024, 768, 390, 320] as const;

async function settle(page: Page) {
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

/** Screenshots one state at every review width and fails on horizontal page overflow. */
async function review(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  // Transient toasts would cover the reviewed state.
  await page.addStyleTag({ content: '[data-sonner-toaster] { display: none !important; }' });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} overflows at ${width}px`).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`${name}-${width}.png`),
      fullPage,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

const everyDay = (startTime: string, endTime: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, isOff: false, startTime, endTime }));

test('per-day shift hours, weekly rotation, read-only cross-line visibility and delete modes', async ({
  trackedBrowser: browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'deletemodes');
  const page = await fixture.context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });

  // The fixture shift covers the whole day so a Henkaten can be submitted at any time.
  const base = await get<{ version: number }>(
    fixture.request,
    `/api/v1/supplier/master-data/shift-templates/${fixture.shiftTemplate.id}`,
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/shift-templates/${fixture.shiftTemplate.id}`,
    { expectedVersion: base.version, weeklySchedule: everyDay('00:00', '23:59') },
    fixture.csrf,
  );

  // 1. Create a shift with different hours per day and weekend off days.
  await page.goto(`${runtime.supplierOrigin}/master-data/shifts/new`);
  await page.getByLabel('Nama template').fill('Shift Kantor');
  const editor = page.getByRole('region', { name: 'Jadwal mingguan' });
  await editor.getByRole('button', { name: 'Sen–Jum', exact: true }).click();
  await editor.getByLabel('Mulai', { exact: true }).fill('07:00');
  await editor.getByLabel('Selesai', { exact: true }).fill('16:00');
  await expect(editor).toContainText('Sen–Jum 07:00–16:00 · Sab–Min Libur');
  await review(page, testInfo, 'shift-editor-uniform');
  await editor.getByRole('button', { name: 'Per hari', exact: true }).click();
  await editor.getByLabel('Selesai Jumat').fill('11:30');
  await editor.getByRole('switch', { name: 'Sabtu' }).click();
  await editor.getByLabel('Mulai Sabtu').fill('22:00');
  await editor.getByLabel('Selesai Sabtu').fill('06:00');
  await expect(editor).toContainText('Sen–Kam 07:00–16:00 · Jum 07:00–11:30');
  expect(
    (
      await new AxeBuilder({ page })
        .include('.shift-editor')
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await review(page, testInfo, 'shift-editor-per-day');
  await page.getByRole('button', { name: 'Buat data', exact: true }).click();
  await expect(page).toHaveURL(/\/master-data\/shifts\/[0-9a-f-]{36}$/);
  const officeShiftId = page.url().split('/').at(-1)!;

  // 2. Configure a weekly rotation between two shifts.
  await page.goto(`${runtime.supplierOrigin}/master-data/shifts`);
  const panel = page.getByRole('region', { name: 'Jadwal pergantian shift' });
  await expect(panel).toContainText('Belum ada jadwal');
  await panel.getByRole('button', { name: 'Buat jadwal' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Jadwal pergantian shift' });
  await chooseOption(sheet.getByRole('combobox', { name: 'Shift 1' }), fixture.shiftTemplate.id);
  await chooseOption(sheet.getByRole('combobox', { name: 'Shift 2' }), officeShiftId);
  await sheet.getByRole('radio', { name: 'Senin' }).click();
  await sheet.getByLabel('Jam', { exact: true }).fill('05:30');
  await expect(sheet.locator('.rotation-preview li')).toHaveCount(2);
  await review(page, testInfo, 'rotation-sheet', false);
  await sheet.getByRole('button', { name: 'Buat jadwal' }).click();
  await expect(panel.locator('.rotation-card')).toHaveCount(1);
  await expect(panel).toContainText('Setiap Senin · 05:30');
  await expect(page.locator('.shift-strip').first()).toBeVisible();
  await review(page, testInfo, 'shift-list-rotation');
  await panel.getByRole('button', { name: 'Riwayat' }).click();
  await panel.getByRole('button', { name: 'Jalankan sekarang' }).click();
  const run = page.getByRole('dialog', { name: 'Rotasi jam shift sekarang?' });
  await review(page, testInfo, 'rotation-run-confirm', false);
  await run.getByRole('button', { name: 'Rotasi sekarang' }).click();
  await expect(panel).toContainText('Berhasil');
  const rotated = await get<{ startTime: string }>(
    fixture.request,
    `/api/v1/supplier/master-data/shift-templates/${fixture.shiftTemplate.id}`,
  );
  expect(rotated.startTime).toBe('07:00');
  // Rotate back so the operational shift covers the whole day again.
  const rotations = await get<{ items: Array<{ id: string; version: number }> }>(
    fixture.request,
    '/api/v1/supplier/master-data/shift-rotations',
  );
  await post(
    fixture.request,
    `/api/v1/supplier/master-data/shift-rotations/${rotations.items[0]!.id}/run`,
    { expectedVersion: rotations.items[0]!.version },
    fixture.csrf,
  );

  // 3. Line A runs with an assigned Supervisor, Line Leader and MP; the leader opens a Henkaten.
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
    'deletemodes-leader',
  );
  const henkaten = await post<{ id: string; version: number }>(
    leader.context.request,
    '/api/v1/supplier/henkatens',
    {
      category: 'METHOD',
      jobId: fixture.job.id,
      partId: fixture.part.id,
      cause: 'Perubahan urutan kerja',
      detail: 'Urutan pemasangan baut diubah',
      affectedObject: 'SOP v1',
      replacementObject: 'SOP v2',
    },
    leader.csrf,
    201,
    crypto.randomUUID(),
  );

  // 4. A Line Leader of another line reads the record and the board but cannot act.
  const viewer = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.donorLeader.credential!,
    'deletemodes-viewer',
  );
  const viewerPage = await viewer.context.newPage();
  await viewerPage.emulateMedia({ reducedMotion: 'reduce' });
  await viewerPage.setViewportSize({ width: 1440, height: 900 });
  await viewerPage.goto(`${runtime.supplierOrigin}/henkatens`);
  await expect(viewerPage.getByRole('button', { name: 'Semua line' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(viewerPage.getByText(/HEN-/).first()).toBeVisible();
  await review(viewerPage, testInfo, 'henkaten-list-all-lines');
  await viewerPage.getByRole('button', { name: 'Line saya' }).click();
  await expect(viewerPage.getByText('Tidak ada Henkaten')).toBeVisible();
  await viewerPage.goto(`${runtime.supplierOrigin}/henkatens/${henkaten.id}`);
  await expect(viewerPage.locator('.view-only-pill')).toContainText('Hanya lihat');
  await expect(viewerPage.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  await expect(viewerPage.getByText('Clone Henkaten')).toHaveCount(0);
  await review(viewerPage, testInfo, 'henkaten-detail-view-only');
  await viewerPage.goto(`${runtime.supplierOrigin}/board?shiftStatus=ALL`);
  await expect(viewerPage.locator('.board-line .view-only-pill').first()).toBeVisible();
  await review(viewerPage, testInfo, 'board-all-lines');

  // 5. The assigned Supervisor may edit the line's board layout.
  const supervisor = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.supervisor.credential!,
    'deletemodes-supervisor',
  );
  const layout = await get<{ canEdit: boolean }>(
    supervisor.context.request,
    `/api/v1/supplier/assignment-board/layouts/${fixture.line.id}`,
  );
  expect(layout.canEdit).toBe(true);
  const viewerLayout = await get<{ canEdit: boolean }>(
    viewer.context.request,
    `/api/v1/supplier/assignment-board/layouts/${fixture.line.id}`,
  );
  expect(viewerLayout.canEdit).toBe(false);
  const supervisorPage = await supervisor.context.newPage();
  await supervisorPage.setViewportSize({ width: 1440, height: 900 });
  await supervisorPage.goto(
    `${runtime.supplierOrigin}/board?shiftStatus=ALL&lineId=${fixture.line.id}&lineShiftId=${lineShift.id}&view=canvas`,
  );
  await expect(supervisorPage.getByRole('button', { name: 'Edit layout' })).toBeVisible();
  await supervisorPage.screenshot({
    path: testInfo.outputPath('board-canvas-supervisor-1440.png'),
    animations: 'disabled',
  });

  // 6. Deleting the line is blocked by the Open Henkaten and links to it.
  await page.goto(`${runtime.supplierOrigin}/master-data/lines/${fixture.line.id}`);
  await page.getByRole('button', { name: 'Hapus', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Line belum bisa dihapus' });
  await expect(blocked).toContainText('1 Henkaten masih Open');
  await expect(blocked.getByRole('link', { name: /HEN-/ })).toHaveAttribute(
    'href',
    `/henkatens/${henkaten.id}`,
  );
  await review(page, testInfo, 'line-delete-blocked', false);

  await post(
    leader.context.request,
    `/api/v1/supplier/henkatens/${henkaten.id}/withdraw`,
    { expectedVersion: henkaten.version, reason: 'Salah input' },
    leader.csrf,
  );
  await blocked.getByRole('button', { name: 'Periksa lagi' }).click();
  const confirm = page.getByRole('dialog', { name: 'Hapus line?' });
  await expect(confirm.getByRole('radio', { name: /Arsipkan/ })).toBeChecked();
  await expect(confirm).toContainText('Line–Shift dilepas');
  await expect(confirm.getByRole('button', { name: 'Arsipkan' })).toBeDisabled();
  expect(
    (
      await new AxeBuilder({ page })
        .include('.master-delete-dialog')
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await review(page, testInfo, 'line-delete-archive', false);
  await confirm.getByText('Hapus permanen', { exact: true }).click();
  await review(page, testInfo, 'line-delete-permanent', false);
  await confirm.getByText('Arsipkan', { exact: true }).first().click();
  await confirm.getByRole('checkbox').click();
  await confirm.getByRole('button', { name: 'Arsipkan' }).click();
  await expect(page.locator('.lifecycle-state')).toHaveText('Di arsip');

  // 7. From the archive the line is removed permanently and its code is free again.
  await page.goto(`${runtime.supplierOrigin}/master-data/lines?active=INACTIVE`);
  await page.getByRole('button', { name: 'Hapus permanen' }).first().click();
  const permanent = page.getByRole('dialog', { name: 'Hapus permanen line?' });
  await expect(permanent.getByRole('radio', { name: /Hapus permanen/ })).toBeChecked();
  await permanent.getByRole('checkbox').click();
  await permanent.getByRole('button', { name: 'Hapus permanen' }).click();
  await expect(permanent).toHaveCount(0);
  await post(
    fixture.request,
    '/api/v1/supplier/master-data/lines',
    { code: 'LINE-deletemodes-A', name: 'Line deletemodes A' },
    fixture.csrf,
  );
});
