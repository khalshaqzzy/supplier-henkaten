import { expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { AxeBuilder } from '@axe-core/playwright';
import {
  chooseOption,
  createHostedFixture,
  loginBootstrapThroughApi,
  runtime,
  test,
  post,
} from './support.js';

const headers = 'Kode member,Nama,Role,Nomor registrasi,Username,Password awal';
test('imports only members and accounts with Excel, CSV review, recovery and separate activation @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const tmmin = await browser.newContext();
  const csrf = await loginBootstrapThroughApi(tmmin.request);
  const fixture = await createHostedFixture(browser, tmmin.request, csrf, 'member-import');
  const page = await fixture.context.newPage();
  await page.goto(`${runtime.supplierOrigin}/master-data/members`);
  await expect(page.getByRole('button', { name: 'Import CSV / Excel' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Import CSV / Excel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Member & Akun', exact: true });
  const input = dialog.locator('input[type=file]');
  const capture = async (state: string) => {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const footer = await dialog.locator('.hds-dialog__footer').boundingBox();
      expect(footer).not.toBeNull();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(901);
      await expect(
        dialog.locator('.hds-dialog__footer').getByRole('button').first(),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`member-${state}-${width}.png`),
        animations: 'disabled',
      });
      if (
        ['review', 'error', 'file-error', 'server-error', 'upload'].includes(state) &&
        width === 1440
      ) {
        const snapshot = await page.evaluate(() => {
          const css = Array.from(document.styleSheets)
            .flatMap((sheet) => {
              try {
                return Array.from(sheet.cssRules).map((rule) => rule.cssText);
              } catch {
                return [];
              }
            })
            .join('\n');
          return (
            '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
            css +
            '</style></head><body>' +
            document.querySelector('[role="dialog"]')!.outerHTML +
            '</body></html>'
          );
        });
        await writeFile(testInfo.outputPath(`member-${state}.html`), snapshot);
      }
    }
  };
  await capture('upload');
  await input.setInputFiles({
    name: 'broken.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('not an Excel file'),
  });
  await expect(dialog.getByText('File belum dapat diproses', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('File Excel tidak dapat dibaca. Simpan ulang sebagai .xlsx.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Berubah', { exact: true })).toHaveCount(0);
  await capture('file-error');
  await input.setInputFiles({
    name: 'shifted.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(headers + '\nM1,Operator,MP,,,,extra'),
  });
  await expect(dialog.getByText(/7 kolom; header memiliki 6/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeDisabled();
  await input.setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(headers + '\nQC-X,QC,QC,,,do-not-show-this-password'),
  });
  await expect(dialog.getByText(/error perlu diperbaiki/)).toBeVisible();
  await expect(dialog).not.toContainText('do-not-show-this-password');
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Isi nomor registrasi/)).toBeVisible();
  await expect(dialog.getByText(/Isi username/)).toBeVisible();
  await capture('error');
  const template = await fixture.request.get(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/members/import/template`,
  );
  expect(template.status()).toBe(200);
  const previews: string[] = [];
  await page.route('**/members/import/preview', async (route) => {
    previews.push(route.request().postData()!);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await input.setInputFiles({
    name: 'member.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await template.body(),
  });
  await expect(dialog.locator('[aria-busy=true]')).toBeVisible();
  await capture('loading');
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeEnabled();
  expect(previews.every((body) => !body.includes('"password"'))).toBe(true);
  await capture('review');
  expect((await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations).toEqual(
    [],
  );
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route('**/members/import/commit', async (route) => {
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    });
    if (requests.length === 1) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Import data', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Periksa hasil', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Periksa hasil', exact: true }).click();
  await expect(dialog.getByText('Data berhasil diimport', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  await capture('result');
  await dialog.getByRole('link', { name: /^Lihat member/ }).click();
  await page.getByRole('button', { name: 'Import CSV / Excel' }).click();
  await input.setInputFiles({
    name: 'conflicting-code.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(headers + '\nQC-OTHER,QC contoh 1,QC,001003,qc.contoh,'),
  });
  await expect(dialog.getByText(/Member ini sudah memiliki kode berbeda/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeDisabled();
  await capture('server-error');
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.getByRole('button', { name: 'Tutup import', exact: true }).click();
  const before = await (
    await fixture.request.get(`${runtime.apiOrigin}/api/v1/supplier/master-data/lines`)
  ).json();
  const forged = await fixture.request.post(
    `${runtime.apiOrigin}/api/v1/supplier/master-data/members/import/preview`,
    {
      headers: { Origin: runtime.supplierOrigin, 'X-CSRF-Token': fixture.csrf },
      data: {
        rows: [
          { sheet: 'Line', sourceRow: 2, data: { code: 'FORGED', name: 'Blocked', order: '1' } },
        ],
      },
    },
  );
  expect(forged.status()).toBe(400);
  const after = await (
    await fixture.request.get(`${runtime.apiOrigin}/api/v1/supplier/master-data/lines`)
  ).json();
  expect(after).toEqual(before);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Import CSV / Excel' }).click();
  await input.setInputFiles({
    name: 'member.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      headers + '\nQC-01,QC diperbarui,QC,001003,qc.contoh,\nMP-02,Operator CSV,MP,,,',
    ),
  });
  await expect(dialog.getByText('QC diperbarui', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Update semua', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import data', exact: true }).click();
  await expect(dialog.getByText('Data berhasil diimport', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await dialog.getByRole('button', { name: 'Selesai', exact: true }).click();
  const members = (await (
    await fixture.request.get(`${runtime.apiOrigin}/api/v1/supplier/master-data/members?limit=100`)
  ).json()) as { items: { id: string; fullName: string; version: number }[] };
  const qc = members.items.find(
    (member: { fullName: string }) => member.fullName === 'QC diperbarui',
  );
  expect(qc).toBeTruthy();
  if (!qc) throw new Error('Imported QC missing');
  await post(
    fixture.request,
    `/api/v1/supplier/master-data/members/${qc.id}/deactivate`,
    { expectedVersion: qc.version },
    fixture.csrf,
  );
  await page.getByRole('button', { name: 'Import CSV / Excel' }).click();
  await input.setInputFiles({
    name: 'restore.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(headers + '\nQC-01,QC diperbarui,QC,001003,qc.contoh,'),
  });
  await expect(dialog.getByRole('combobox', { name: 'Aksi', exact: true })).toBeVisible();
  await chooseOption(dialog.getByRole('combobox', { name: 'Aksi', exact: true }), 'RESTORE');
  await expect(dialog.getByRole('button', { name: 'Import data', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import data', exact: true }).click();
  await expect(dialog.getByText('Data berhasil diimport', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const restored = await (
    await fixture.request.get(`${runtime.apiOrigin}/api/v1/supplier/master-data/members/${qc.id}`)
  ).json();
  expect(restored.active).toBe(true);
  expect(restored.account.status).toBe('INACTIVE');
  await fixture.context.close();
  await tmmin.close();
});
