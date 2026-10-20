import { expect, type Browser, type BrowserContext } from '@playwright/test';

import { createHostedFixture, loginBootstrapThroughUi, runtime, test } from './support.js';

test('restores both portals from persistent cookies and revokes them on logout @edge', async ({
  trackedBrowser: browser,
}, testInfo) => {
  const originalTmmin = await browser.newContext();
  const tmmin = await originalTmmin.newPage();
  const csrf = await loginBootstrapThroughUi(tmmin);
  const fixture = await createHostedFixture(browser, originalTmmin.request, csrf, 'persistence');
  await fixture.context.close();

  const originalSupplier = await browser.newContext();
  const supplier = await originalSupplier.newPage();
  await supplier.goto(`${runtime.supplierOrigin}/login`);
  await supplier.getByLabel('Supplier Code').fill(fixture.supplier.code);
  await supplier.getByLabel('Username').fill(fixture.admin.username);
  await supplier.getByLabel(/^Password/).fill(fixture.admin.password);
  await supplier.getByRole('button', { name: 'Masuk' }).click();
  await expect(supplier.getByRole('heading', { name: 'Overview Supplier' })).toBeVisible();

  for (const [realm, origin, original] of [
    ['tmmin', runtime.tmminOrigin, originalTmmin],
    ['supplier', runtime.supplierOrigin, originalSupplier],
  ] as const) {
    const restored = await restoreFromCookies(browser, original, realm);
    try {
      const page = await restored.newPage();
      await page.goto(`${origin}/account`);
      await expect(page.getByRole('heading', { name: 'Akun', exact: true })).toBeVisible();
      if (realm === 'tmmin') {
        await expect(page.getByText('Sesi berakhir')).toBeVisible();
        await expect(page.getByText('Idle expiry')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('tmmin-account-expiry.png') });
      }
      // Closing and reopening a tab retains the same persistent session.
      await page.close();
      const reopened = await restored.newPage();
      await reopened.goto(`${origin}/account`);
      await expect(reopened.getByRole('heading', { name: 'Akun', exact: true })).toBeVisible();
      const sessionResponse = await restored.request.get(
        `${runtime.apiOrigin}/api/v1/auth/${realm}/session`,
      );
      expect(sessionResponse.status()).toBe(200);
      const session = await sessionResponse.json();
      expect(session.idleExpiresAt).toBe(session.absoluteExpiresAt);
      // Logout is a real CSRF-backed mutation using the token recovered on bootstrap.
      await reopened.getByRole('button', { name: 'Keluar', exact: true }).last().click();
      await expect(reopened).toHaveURL(/\/login$/);
      const afterLogout = await restored.request.get(
        `${runtime.apiOrigin}/api/v1/auth/${realm}/session`,
      );
      expect(afterLogout.status()).toBe(401);
      await reopened.goto(`${origin}/account`);
      await expect(reopened).toHaveURL(/\/login$/);
    } finally {
      await restored.close();
    }
  }
});

async function restoreFromCookies(browser: Browser, original: BrowserContext, realm: string) {
  const cookies = (await original.cookies()).filter((cookie) =>
    cookie.name.endsWith(`_${realm}_session`),
  );
  expect(cookies).toHaveLength(1);
  const session = cookies[0]!;
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe('Strict');
  // A persistent expiry, rather than a session-only cookie, survives browser storage restoration.
  expect(session.expires * 1_000 - Date.now()).toBeGreaterThan(29 * 86_400_000);
  expect(session.expires * 1_000 - Date.now()).toBeLessThanOrEqual(30 * 86_400_000);
  await original.close();
  return browser.newContext({ storageState: { cookies, origins: [] } });
}
