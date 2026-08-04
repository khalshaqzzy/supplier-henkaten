import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

import { loginBootstrapThroughUi, runtime, test } from './support.js';

test('onboards a Hosted tenant through both portals and completes start-ready setup @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const tmminContext = await browser.newContext();
  const tmmin = await tmminContext.newPage();
  await tmmin.goto(`${runtime.tmminOrigin}/login`);
  await expectFourMLegend(tmmin);
  await expectKeyboardSequence(tmmin, ['Username', 'Password'], 'Masuk');
  expect((await new AxeBuilder({ page: tmmin }).analyze()).violations).toEqual([]);
  await captureAuthEvidence(tmmin, 'tmmin-login', testInfo);
  await loginBootstrapThroughUi(tmmin);

  const tmminA11y = await new AxeBuilder({ page: tmmin }).analyze();
  expect(tmminA11y.violations).toEqual([]);

  await tmmin.goto(`${runtime.tmminOrigin}/suppliers/new`);
  await tmmin.getByLabel('Supplier code').fill('E2E-ONBOARD');
  await tmmin.getByLabel('Supplier name').fill('E2E Onboarding Supplier');
  await tmmin.getByLabel('IANA timezone').fill('Asia/Jakarta');
  await tmmin.getByLabel('Supplier Admin username').fill('supplier.admin');
  await tmmin.getByLabel('Supplier Admin display name').fill('Supplier Admin E2E');
  await tmmin.getByRole('button', { name: 'Buat supplier' }).click();
  await expect(tmmin.getByText('Simpan temporary credential sekarang')).toBeVisible();
  const passwordRow = tmmin.getByText('Temporary password', { exact: true }).locator('..');
  const temporaryPassword = (await passwordRow.locator('code').innerText())
    .replace('Salin', '')
    .trim();
  await tmmin.getByLabel('Saya sudah menyimpan credential pada lokasi yang aman.').check();
  await tmmin.getByRole('button', { name: 'Selesai' }).click();
  await expect(tmmin).toHaveURL(/\/suppliers$/);

  const supplierContext = await browser.newContext();
  const supplier = await supplierContext.newPage();
  await supplier.goto(`${runtime.supplierOrigin}/login`);
  await expectFourMLegend(supplier);
  await expectKeyboardSequence(supplier, ['Supplier Code', 'Username', 'Password'], 'Masuk');
  expect((await new AxeBuilder({ page: supplier }).analyze()).violations).toEqual([]);
  await captureAuthEvidence(supplier, 'supplier-login', testInfo);
  await supplier.getByLabel('Supplier Code').fill('E2E-ONBOARD');
  await supplier.getByLabel('Username').fill('supplier.admin');
  await supplier.getByLabel('Password').fill(temporaryPassword);
  await supplier.getByRole('button', { name: 'Masuk' }).click();
  await expect(supplier).toHaveURL(/\/change-password$/);
  const supplierPassword = 'E2e-Onboard-Supplier-Password';
  await supplier.getByLabel('Password sekarang').fill(temporaryPassword);
  await supplier.getByLabel(/^Password baru/).fill(supplierPassword);
  await supplier.getByLabel('Konfirmasi password baru').fill(supplierPassword);
  await supplier.getByRole('button', { name: 'Simpan dan masuk ulang' }).click();
  await expect(supplier).toHaveURL(/\/login$/);
  await supplier.getByLabel('Supplier Code').fill('E2E-ONBOARD');
  await supplier.getByLabel('Username').fill('supplier.admin');
  await supplier.getByLabel('Password').fill(supplierPassword);
  await supplier.getByRole('button', { name: 'Masuk' }).click();
  await expect(supplier.getByRole('heading', { name: 'Overview Supplier' })).toBeVisible();

  await createResource(supplier, 'lines', {
    'Kode line': 'LINE-ONBOARD',
    'Nama line': 'Assembly Onboarding',
  });
  await supplier.getByPlaceholder('Nama job baru').fill('Install Component');
  await supplier.getByRole('button', { name: 'Tambah job' }).click();
  await expect(supplier.getByText('Install Component')).toBeVisible();

  await createResource(supplier, 'parts', {
    'Part number': 'PART-ONBOARD',
    'Nama part': 'Onboarding Part',
  });
  await createResource(supplier, 'shifts', {
    'Nama template': 'Shift Pagi',
    Mulai: '06:00',
    Selesai: '14:00',
    'IANA timezone': 'Asia/Jakarta',
  });

  for (const [index, role] of ['Supervisor', 'Line Leader', 'QC', 'MP'].entries()) {
    await supplier.goto(`${runtime.supplierOrigin}/master-data/members/new`);
    await supplier.getByLabel('Nama lengkap').fill(`${role} Onboarding`);
    await supplier.getByLabel('Nomor registrasi').fill(`REG-ONBOARD-${index + 1}`);
    await supplier
      .getByLabel('Role')
      .selectOption(role === 'Line Leader' ? 'LINE_LEADER' : role.toUpperCase());
    if (role !== 'MP') {
      await supplier.getByLabel('Username').fill(`${role.toLowerCase().replace(' ', '.')}.onboard`);
    }
    await supplier.getByRole('button', { name: 'Buat data' }).click();
    if (role !== 'MP') {
      await expect(supplier.getByText('Simpan temporary credential dengan aman')).toBeVisible();
      await supplier.getByLabel(/Saya sudah menyimpan dan akan menyalurkan credential/).check();
      await supplier.getByRole('button', { name: 'Selesai' }).click();
    } else {
      await expect(supplier).toHaveURL(/\/master-data\/members\/[^/]+$/);
    }
  }

  for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD']) {
    await supplier.goto(`${runtime.supplierOrigin}/master-data/checklists/${category}`);
    await supplier.getByRole('button', { name: 'Tambah item' }).click();
    await supplier.locator('.checklist-editor input').last().fill(`${category} verified`);
    await supplier.getByRole('button', { name: 'Simpan draft' }).click();
    await expect(supplier.getByText(/Version 2/)).toBeVisible();
    supplier.once('dialog', (dialog) => dialog.accept());
    await supplier.getByRole('button', { name: 'Publish' }).click();
    await expect(supplier.getByText('Version 1', { exact: false })).toBeVisible();
  }

  await supplier.goto(`${runtime.supplierOrigin}/master-data/default-assignments`);
  await expect(supplier.getByRole('heading', { name: 'Default Assignment' })).toBeVisible();
  for (const [memberLabel, optionLabel] of [
    ['Supervisor Onboarding', 'Supervisor Onboarding · REG-ONBOARD-1'],
    ['Line Leader Onboarding', 'Line Leader Onboarding · REG-ONBOARD-2'],
    ['MP Onboarding', 'MP Onboarding · REG-ONBOARD-4'],
  ] as const) {
    await supplier.getByRole('button', { name: 'Assign' }).first().click();
    const assignmentSheet = supplier.getByRole('dialog');
    await expect(assignmentSheet).toBeVisible();
    await assignmentSheet.getByLabel('Member tersedia').selectOption({ label: optionLabel });
    await assignmentSheet.getByRole('button', { name: 'Konfirmasi perubahan' }).click();
    await expect(assignmentSheet).toBeHidden();
    await expect(supplier.getByText(memberLabel, { exact: true }).first()).toBeVisible();
  }

  await supplier.goto(`${runtime.supplierOrigin}/setup`);
  await expect(supplier.getByText('Siap beroperasi')).toBeVisible();

  const supplierA11y = await new AxeBuilder({ page: supplier }).analyze();
  expect(supplierA11y.violations).toEqual([]);
  expect(await supplier.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await supplier.evaluate(() => document.documentElement.clientWidth),
  );

  await supplierContext.close();
  await tmminContext.close();
});

async function expectFourMLegend(page: Page) {
  const legend = page.getByRole('list', { name: 'Kategori Henkaten 4M' });
  const expected = [
    ['Man', 'rgb(220, 38, 38)'],
    ['Machine', 'rgb(47, 111, 237)'],
    ['Material', 'rgb(217, 119, 6)'],
    ['Method', 'rgb(22, 163, 74)'],
  ] as const;

  await expect(legend).toBeVisible();
  const items = legend.getByRole('listitem');
  await expect(items).toHaveCount(expected.length);
  for (const [index, [label, color]] of expected.entries()) {
    const item = items.nth(index);
    await expect(item).toHaveAccessibleName(label);
    await expect(item.locator('i')).toHaveCSS('background-color', color);
    await expect(item.locator('span')).toHaveCSS('font-weight', '400');
    await expect(item.locator('strong')).toHaveText('M');
    await expect(item.locator('strong')).toHaveCSS('font-weight', '700');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
}

async function expectKeyboardSequence(page: Page, fieldLabels: string[], submitName: string) {
  await page.getByLabel(fieldLabels[0]!).focus();
  for (const label of fieldLabels.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(label)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: submitName })).toBeFocused();
}

async function captureAuthEvidence(page: Page, name: string, testInfo: TestInfo) {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1672, height: 941 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await page.screenshot({
      path: testInfo.outputPath(`${name}-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function createResource(
  page: import('@playwright/test').Page,
  kind: 'lines' | 'parts' | 'shifts',
  fields: Record<string, string>,
) {
  await page.goto(`${runtime.supplierOrigin}/master-data/${kind}/new`);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Buat data' }).click();
  await expect(page).toHaveURL(new RegExp(`/master-data/${kind}/[^/]+$`));
}
