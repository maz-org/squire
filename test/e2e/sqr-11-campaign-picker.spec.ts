/**
 * Campaign picker E2E (SQR-11): list/create happy path, active-campaign
 * switching reflected by the context strip, and the navigation bridge
 * (chat → strip → dashboard). Failure path: campaign creation blocked by
 * the allowlist is covered at the integration layer
 * (test/campaign-pages.test.ts) because the E2E server pins the dev user
 * onto the allowlist for the happy path.
 */
import { expect, type Page, test } from '@playwright/test';

async function loginAsDevUser(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in as Dev User' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in as Dev User' }).click();
  await expect(page).toHaveURL('/');
}

test.describe('campaign picker and context strip', () => {
  test('creates a campaign, switches activation, and bridges via the strip', async ({ page }) => {
    await loginAsDevUser(page);

    // Chat home shows the set-up affordance or an existing campaign strip.
    await expect(page.locator('.squire-campaign-strip')).toBeVisible();

    await page.goto('/campaigns');
    const name = `E2E Campaign ${Date.now()}`;
    await page.getByLabel('NAME').fill(name);
    await page.getByLabel('GAME').selectOption('frosthaven');
    await page.getByRole('button', { name: 'CREATE' }).click();

    // Create redirects to the new dashboard with the prominent strip.
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.locator('.squire-campaign-strip--prominent')).toContainText(
      name.toUpperCase(),
    );

    // The picker lists it as ACTIVE; the strip bridges from chat home.
    await page.goto('/campaigns');
    const row = page.locator('.squire-campaigns__row', { hasText: name });
    await expect(row.locator('.squire-campaigns__active')).toHaveText('ACTIVE');

    await page.goto('/');
    await expect(page.locator('.squire-campaign-strip')).toContainText(name.toUpperCase());
    // E8: an active campaign hides the per-session game selector.
    await expect(page.locator('.squire-game-picker')).toHaveCount(0);
    await page.locator('.squire-campaign-strip').click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}/);
  });
});
