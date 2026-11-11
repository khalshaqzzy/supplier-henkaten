import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import {
  chooseOption,
  createHostedFixture,
  loginBootstrapThroughApi,
  runtime,
  test,
} from './support.js';

async function settleAnimations(page: Page) {
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Supplier Admin edits a member on the detail page and uses the shared select', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'member-detail');
  const page = await fixture.context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Identity header, rail and read-only role with its change action.
  await page.goto(`${runtime.supplierOrigin}/master-data/members/${fixture.members.leader.id}`);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  const originalName = (await heading.textContent())!.trim();
  await expect(page.getByRole('button', { name: 'Ubah role', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Akun', exact: true })).toContainText('Akun aktif');
  await expect(page.getByRole('button', { name: /Salin username/ })).toBeVisible();
  const save = page.getByRole('button', { name: 'Simpan perubahan', exact: true });
  await expect(save).toBeDisabled();

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settleAnimations(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`member-detail-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(
    (
      await new AxeBuilder({ page })
        .include('.member-detail')
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);

  // Unsaved changes are announced, can be discarded, then saved without leaving the page.
  const name = page.getByLabel('Nama lengkap');
  await name.fill(`${originalName} Revisi`);
  await expect(page.getByText('Perubahan belum disimpan')).toBeVisible();
  await expect(save).toBeEnabled();
  await settleAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath('member-detail-dirty-1440.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Batalkan', exact: true }).click();
  await expect(name).toHaveValue(originalName);
  await expect(save).toBeDisabled();
  await name.fill(`${originalName} Revisi`);
  await save.click();
  await expect(heading).toHaveText(`${originalName} Revisi`);
  await expect(page).toHaveURL(new RegExp(`/master-data/members/${fixture.members.leader.id}$`));
  await expect(page.getByText('Tersimpan')).toBeVisible();

  // MP members have no account or registration and no role change.
  await page.goto(`${runtime.supplierOrigin}/master-data/members/${fixture.members.mp.id}`);
  await expect(page.getByText('Tanpa akun login')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ubah role', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Nomor registrasi')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await settleAnimations(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`member-detail-mp-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }

  // Shared select: keyboard selection, descriptions and baselines of the open list.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${runtime.supplierOrigin}/master-data/members/new`);
  const role = page.getByRole('combobox', { name: 'Role' });
  await expect(role).toHaveText('MP');
  await role.focus();
  await page.keyboard.press('ArrowDown');
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  await expect(
    list.getByRole('option', { name: 'Line Leader', exact: true }),
  ).toHaveAccessibleDescription('Input dan tindak lanjut Henkaten');
  await settleAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath('select-role-open-1440.png'),
    animations: 'disabled',
  });
  expect(
    (
      await new AxeBuilder({ page })
        .include('.hds-select__content')
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(role).toHaveText('Line Leader');
  await expect(role).toBeFocused();
  await expect(page.getByLabel('Username')).toBeVisible();
  await chooseOption(role, { label: 'QC' });
  await expect(role).toHaveText('QC');

  // Filter selects with an empty "all" value in a list toolbar, desktop and phone.
  await page.goto(`${runtime.supplierOrigin}/master-data/members`);
  const status = page.getByRole('combobox', { name: 'Status' });
  await expect(status).toHaveText('Aktif');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await status.click();
    await expect(list).toBeVisible();
    await settleAnimations(page);
    const bounds = await page.locator('.hds-select__content').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`select-status-open-${width}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(status).toBeFocused();
  }
  await chooseOption(status, 'ALL');
  await expect(page).toHaveURL(/active=ALL/);
});
