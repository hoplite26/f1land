import { expect, test, type Page } from '@playwright/test';

/** Mobile smoke suite over the production build (2D track mode keeps SwiftShader fast). */

const settings = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    state: { lang: 'ru', quality: 'low', motion: 'reduced', haptics: true, sound: false, renderMode: '2d', camera: 'director', showZones: true, favoriteDriver: null, onboarded: true, ...over },
    version: 1,
  });

async function boot(page: Page, over?: Record<string, unknown>): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Seed once per test; reloads keep whatever the app persisted since.
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    localStorage.clear();
    localStorage.setItem('pa-f1-settings', s);
    sessionStorage.setItem('e2e-seeded', '1');
  }, settings(over));
  await page.goto('/');
  await expect(page.locator('nav.nav')).toBeVisible();
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('main.screen');
    return Math.max(document.documentElement.scrollWidth - window.innerWidth, screen ? screen.scrollWidth - screen.clientWidth : 0);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

const navButton = (page: Page, i: number) => page.locator('nav.nav button').nth(i);

test('every tab renders without errors or horizontal overflow', async ({ page }) => {
  const errors = await boot(page);
  for (let i = 0; i < 5; i++) {
    await navButton(page, i).click();
    await expect(navButton(page, i)).toHaveAttribute('aria-current', 'page');
    await page.waitForTimeout(400);
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test('first launch shows onboarding that can be skipped', async ({ page }) => {
  await boot(page, { onboarded: false });
  const dialog = page.locator('.sc-onb[role=dialog]');
  await expect(dialog).toBeVisible();
  await dialog.locator('.sc-onb__skip').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.locator('nav.nav')).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('switching the language to English updates the UI', async ({ page }) => {
  await boot(page);
  await navButton(page, 4).click();
  await page.locator('main.screen').getByRole('button', { name: /Настройки/ }).click();
  await page.getByRole('tab', { name: 'English' }).click();
  await expect(navButton(page, 0)).toContainText('Home');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectNoHorizontalOverflow(page);
});

// Needs data-e2e hooks (pool-card, outcome, bet-dock, confirm-ok, pool-back, entry-card) that the markup does not expose yet — see docs/HANDOFF.md.
test.fixme('a prediction can be placed and is tracked in My pools', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await boot(page);
  await navButton(page, 2).click();
  // Live pool cards link to the pool screen once the session has generated open pools.
  const openPool = page.locator('[data-e2e="pool-card"][data-open="true"]').first();
  await openPool.click({ timeout: 90_000 });
  await expect(page.locator('nav.nav')).toHaveClass(/nav--hidden/);

  const outcome = page.locator('[data-e2e="outcome"]:not([disabled])').first();
  await outcome.click();
  await expect(outcome).toHaveAttribute('aria-pressed', 'true');

  const swipe = page.locator('[data-e2e="bet-dock"] .swipe');
  await expect(swipe).not.toHaveAttribute('aria-disabled', 'true');
  await swipe.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-e2e="confirm-ok"]')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.locator('[data-e2e="pool-back"]').click();
  await navButton(page, 3).click();
  await expect(page.locator('[data-e2e="entry-card"]').first()).toBeVisible();
  await expect(navButton(page, 3).locator('.nav__badge')).toHaveText('1');
  expect(errors).toEqual([]);
});
