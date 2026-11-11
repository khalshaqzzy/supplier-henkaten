import { writeFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
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
  type Credential,
} from './support.js';

test('Supplier Admin changes roles with handover and separately activates restored accounts @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const root = await browser.newContext();
  const rootCsrf = await loginBootstrapThroughApi(root.request);
  const fixture = await createHostedFixture(browser, root.request, rootCsrf, 'role-change');
  const base = '/api/v1/supplier/master-data/members';
  const replacement = await post<{ member: { id: string }; credential: Credential }>(
    fixture.request,
    base,
    {
      role: 'LINE_LEADER',
      fullName: 'Dimas Prasetyo',
      registrationNumber: '120210',
      username: 'dimas.role',
    },
    fixture.csrf,
  );
  const source = await patch<{ id: string; version: number }>(
    fixture.request,
    `${base}/${fixture.members.leader.id}`,
    { expectedVersion: 1, fullName: 'Arrizqo', registrationNumber: '120185' },
    fixture.csrf,
  );
  const ls = await post<{ id: string; version: number }>(
    fixture.request,
    `/api/v1/supplier/master-data/lines/${fixture.line.id}/shifts`,
    { shiftTemplateId: fixture.shiftTemplate.id },
    fixture.csrf,
  );
  await patch(
    fixture.request,
    `/api/v1/supplier/master-data/line-shifts/${ls.id}/assignments`,
    {
      expectedVersion: ls.version,
      supervisorMemberId: fixture.members.supervisor.id,
      lineLeaderMemberId: source.id,
      jobs: [{ jobId: fixture.job.id, mpMemberId: fixture.members.mp.id }],
    },
    fixture.csrf,
  );
  const oldLeader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.leader.credential!,
    'role-old-leader',
  );
  const h = await post<{ id: string }>(
    oldLeader.context.request,
    '/api/v1/supplier/henkatens',
    {
      category: 'MACHINE',
      jobId: fixture.job.id,
      partId: fixture.part.id,
      cause: 'Perubahan mesin',
      detail: 'Pengecekan mesin pengganti',
      affectedObject: 'Mesin A',
      replacementObject: 'Mesin B',
    },
    oldLeader.csrf,
    201,
    crypto.randomUUID(),
  );
  const page = await fixture.context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${runtime.supplierOrigin}/master-data/members/${source.id}`);
  await page.getByRole('button', { name: 'Ubah role', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ubah role member' });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('role-choose-desktop.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('radio', { name: /Supervisor/ }).check();
  await dialog.getByRole('button', { name: 'Tinjau tanggung jawab' }).click();
  await expect(dialog.getByRole('heading', { name: 'Alihkan tanggung jawab' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tinjau perubahan' })).toBeDisabled();
  // One replacement covers the current shift, retained default assignment and Open Henkaten.
  await expect(dialog.getByLabel('Pengganti', { exact: false })).toHaveCount(1);
  for (const field of await dialog.getByLabel('Pengganti', { exact: false }).all())
    await chooseOption(field, replacement.member.id);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Tinjau perubahan' })).toBeInViewport();
    if (width === 1440) {
      const snapshot = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script').forEach((element) => element.remove());
        clone.querySelectorAll('select').forEach((select, index) => {
          const value = document.querySelectorAll('select')[index]?.value;
          Array.from(select.options).forEach((option) =>
            option.toggleAttribute('selected', option.value === value),
          );
        });
        const css = Array.from(document.styleSheets)
          .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
          .join('\n');
        return `<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Supplier Henkaten role handover</title><style>${css} @font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;src:url('./assets/inter.woff2') format('woff2');}</style></head>${clone.outerHTML}</html>`;
      });
      writeFileSync(testInfo.outputPath('role-ui-snapshot.html'), snapshot);
    }
    const a11y = await new AxeBuilder({ page }).include('.member-role-dialog').analyze();
    expect(a11y.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`role-transfer-${width}.png`),
      animations: 'disabled',
    });
  }
  await dialog.getByRole('button', { name: 'Tinjau perubahan' }).click();
  await dialog.getByLabel('Alasan perubahan').fill('Perubahan penugasan menjadi Supervisor');
  await page.screenshot({
    path: testInfo.outputPath('role-review-mobile.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Simpan perubahan role' }).click();
  await expect(dialog).not.toBeVisible();
  const changed = await get<{ id: string; role: string; account: { id: string; status: string } }>(
    fixture.request,
    `${base}/${source.id}`,
  );
  expect(changed.id).toBe(source.id);
  expect(changed.role).toBe('SUPERVISOR');
  const defaults = await get<{ lineLeaders: Array<{ resourceId: string; memberId: string }> }>(
    fixture.request,
    '/api/v1/supplier/master-data/default-assignments',
  );
  expect(defaults.lineLeaders.find((item) => item.resourceId === fixture.line.id)?.memberId).toBe(
    replacement.member.id,
  );
  const revoked = await oldLeader.context.request.get(
    `${runtime.apiOrigin}/api/v1/auth/supplier/session`,
  );
  expect(revoked.status()).toBe(401);
  const nextLeader = await loginRole(
    browser,
    fixture.supplier.code,
    replacement.credential,
    'role-next-leader',
  );
  expect(
    (
      await nextLeader.context.request.get(`${runtime.apiOrigin}/api/v1/supplier/henkatens/${h.id}`)
    ).status(),
  ).toBe(200);
  // The original occurrence still names the old LL. New submissions must use current authority.
  const submittedByNewLl = await post<{ id: string; version: number }>(
    nextLeader.context.request,
    '/api/v1/supplier/henkatens',
    {
      category: 'MACHINE',
      jobId: fixture.job.id,
      partId: fixture.part.id,
      cause: 'New LL submission',
      detail: 'Same occurrence after handover',
      affectedObject: 'Machine C',
      replacementObject: 'Machine D',
    },
    nextLeader.csrf,
    201,
    crypto.randomUUID(),
  );
  await post(
    nextLeader.context.request,
    `/api/v1/supplier/henkatens/${submittedByNewLl.id}/withdraw`,
    { expectedVersion: submittedByNewLl.version, reason: 'New LL can manage their new submission' },
    nextLeader.csrf,
    201,
    crypto.randomUUID(),
  );
  // An unused member can be archived, corrected, restored, then explicitly granted login.
  const extra = await post<{ member: { id: string; version: number } }>(
    fixture.request,
    base,
    {
      role: 'QC',
      fullName: 'Nadia Wulandari',
      registrationNumber: '120244',
      username: 'nadia.role',
    },
    fixture.csrf,
  );
  await post(
    fixture.request,
    `${base}/${extra.member.id}/deactivate`,
    { expectedVersion: extra.member.version },
    fixture.csrf,
  );
  await page.goto(`${runtime.supplierOrigin}/master-data/members/${extra.member.id}`);
  await expect(page.getByRole('button', { name: 'Aktifkan akun', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pulihkan member', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Pulihkan member', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Aktifkan akun', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Aktifkan akun', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Aktifkan akun', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Simpan informasi akun' })).toBeVisible();
  const secret = (await page.locator('.one-time-secret code').textContent())!;
  const activated = await loginRole(
    browser,
    fixture.supplier.code,
    { username: 'nadia.role', temporaryPassword: secret },
    'role-restored',
  );
  await activated.context.close();
  await nextLeader.context.close();
  await oldLeader.context.close();
  await fixture.context.close();
  await root.close();
});
