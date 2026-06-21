/**
 * Campaign picker E2E (SQR-11/SQR-364): list/create happy path, campaign
 * activation reflected in campaign wayfinding, and the chat context bridge
 * to the campaign dashboard. Failure path: campaign creation blocked by the
 * allowlist is covered at the integration layer
 * (test/campaign-pages.test.ts) because the E2E server pins the dev user
 * onto the allowlist for the happy path.
 */
import { expect, type Page, test } from '@playwright/test';

import { resetE2eDb, teardownE2eDb } from './helpers/db.ts';

async function loginAsDevUser(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in as Dev User' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in as Dev User' }).click();
  await expect(page).toHaveURL('/');
}

test.describe('campaign picker and chat context', () => {
  test.beforeEach(async ({ page }) => {
    await resetE2eDb();
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
  });

  test.afterAll(async () => {
    await teardownE2eDb();
  });

  test('creates a campaign, switches activation, and bridges via chat context', async ({
    page,
  }) => {
    await loginAsDevUser(page);

    // Chat home shows the set-up affordance or an existing campaign context.
    await expect(page.locator('.squire-chat-context')).toBeVisible();

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

    // The picker lists it as ACTIVE; the chat context bridges to the dashboard.
    await page.goto('/campaigns');
    const row = page.locator('.squire-campaigns__row', { hasText: name });
    await expect(row.locator('.squire-campaigns__active')).toHaveText('ACTIVE');

    await page.goto('/');
    await expect(page.locator('.squire-header')).not.toContainText(name);
    await expect(page.locator('.squire-chat-context')).toContainText(name);
    // E8: an active campaign hides the per-session game selector.
    await expect(page.locator('.squire-game-picker')).toHaveCount(0);
    await page.getByRole('link', { name: 'Open campaign' }).click();
    await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}/);
  });
});
