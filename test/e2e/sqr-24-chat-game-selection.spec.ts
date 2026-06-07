import { expect, type Page, type Request, test } from '@playwright/test';

interface StreamFixture {
  answerText: string;
  finalHtml: string;
  consultedSources: string[];
}

function sseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function installDeterministicStream(page: Page, fixture: StreamFixture): Promise<void> {
  await page.route('**/chat/*/messages/*/stream', async (route) => {
    const body = [
      sseEvent('tool-start', { id: 'rulebook', label: 'RULEBOOK' }),
      sseEvent('tool-result', { id: 'rulebook', ok: true, labels: ['RULEBOOK'] }),
      sseEvent('text-delta', { delta: fixture.answerText }),
      sseEvent('done', {
        html: fixture.finalHtml,
        consultedSources: fixture.consultedSources,
      }),
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
      body,
    });
  });
}

async function installDelayedDeterministicStream(
  page: Page,
  fixture: StreamFixture,
): Promise<() => void> {
  let releaseStream: () => void = () => {};
  const releasePromise = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });

  await page.route('**/chat/*/messages/*/stream', async (route) => {
    await releasePromise;
    const body = [
      sseEvent('tool-start', { id: 'rulebook', label: 'RULEBOOK' }),
      sseEvent('tool-result', { id: 'rulebook', ok: true, labels: ['RULEBOOK'] }),
      sseEvent('text-delta', { delta: fixture.answerText }),
      sseEvent('done', {
        html: fixture.finalHtml,
        consultedSources: fixture.consultedSources,
      }),
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
      body,
    });
  });

  return releaseStream;
}

async function loginAsDevUser(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in as Dev User' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in as Dev User' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.squire-input-dock')).toBeVisible();
}

async function askQuestionAndCapturePayload(
  page: Page,
  question: string,
): Promise<URLSearchParams> {
  const requestPromise = page.waitForRequest((request) => {
    if (request.method() !== 'POST') return false;
    return request.url().endsWith('/chat') || /\/chat\/[^/]+\/messages$/.test(request.url());
  });

  await page.locator('#squire-input').fill(question);
  await page.locator('.squire-input-dock__submit').click();
  const request = await requestPromise;
  return formDataFromRequest(request);
}

function formDataFromRequest(request: Request): URLSearchParams {
  const body = request.postData();
  expect(body).toBeTruthy();
  return new URLSearchParams(body ?? '');
}

async function expectFinalAnswer(page: Page, expectedAnswer: RegExp): Promise<void> {
  const latestAnswer = page.locator('[data-testid="answer-turn"]').last();
  await expect(latestAnswer).toBeVisible();
  await expect(latestAnswer).toHaveAttribute('data-stream-state', 'done');
  await expect(latestAnswer.locator('[data-testid="answer-content"]')).toContainText(
    expectedAnswer,
  );
  await expect(latestAnswer.locator('[data-testid="answer-content"] a')).toBeVisible();
  await expect(latestAnswer.locator('[data-testid="answer-progress"]')).toContainText(
    'Checked 1 source',
  );
  await expect(latestAnswer.locator('[data-testid="answer-progress"]')).toContainText(
    'Checked rulebook',
  );
  await expect(page.locator('.squire-input-dock')).not.toHaveAttribute('data-submitting', 'true');
}

async function expectChatControlsUsable(page: Page): Promise<void> {
  await expect(page.locator('.squire-game-picker')).toBeVisible();
  await expect(page.locator('.squire-input-dock')).toBeVisible();
  await expect(page.locator('#squire-input')).toBeVisible();
  await expect(page.locator('.squire-input-dock__submit')).toBeVisible();
}

test.describe('SQR-24 browser chat game selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => window.localStorage.clear());
  });

  test('blocks logged-out chat actions and redirects protected chat pages', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.squire-input-dock')).toHaveCount(0);
    await expect(page.locator('.squire-game-picker')).toHaveCount(0);

    await page.goto('/chat/00000000-0000-4000-8000-000000000024');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.squire-input-dock')).toHaveCount(0);
  });

  test('streams a Frosthaven first turn with citations and game metadata', async ({ page }) => {
    await installDeterministicStream(page, {
      answerText: 'Frosthaven says advantage draws two modifier cards.',
      finalHtml:
        '<p>Frosthaven says advantage draws two modifier cards. <a class="cite" href="https://example.test/frosthaven-rulebook">Rulebook p. 27</a></p>',
      consultedSources: ['RULEBOOK'],
    });
    await loginAsDevUser(page);
    await expectChatControlsUsable(page);

    await expect(page.getByLabel('Active game').getByLabel('Frosthaven')).toBeChecked();
    const payload = await askQuestionAndCapturePayload(page, 'How does advantage work?');

    expect(payload.get('game')).toBe('frosthaven');
    expect(payload.get('question')).toBe('How does advantage work?');
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]+$/);
    await expectFinalAnswer(page, /Frosthaven says advantage/);
  });

  test('keeps Gloomhaven 2e context through a follow-up turn', async ({ page }) => {
    await installDeterministicStream(page, {
      answerText: 'Gloomhaven 2e resolves poison before the heal restores hit points.',
      finalHtml:
        '<p>Gloomhaven 2e resolves poison before the heal restores hit points. <a class="cite" href="https://example.test/gh2-rulebook">Rulebook p. 32</a></p>',
      consultedSources: ['RULEBOOK'],
    });
    await loginAsDevUser(page);
    await expectChatControlsUsable(page);

    await page.getByLabel('Active game').getByLabel('Gloomhaven 2e').check();
    await expect(page.getByLabel('Active game').getByLabel('Gloomhaven 2e')).toBeChecked();

    const firstPayload = await askQuestionAndCapturePayload(page, 'How does poison work?');
    expect(firstPayload.get('game')).toBe('gloomhaven-2e');
    await expectFinalAnswer(page, /Gloomhaven 2e resolves poison/);

    const conversationUrl = page.url();
    const followUpPayload = await askQuestionAndCapturePayload(page, 'Does that change healing?');
    expect(followUpPayload.get('game')).toBe('gloomhaven-2e');
    expect(followUpPayload.get('question')).toBe('Does that change healing?');
    await expect(page).toHaveURL(conversationUrl);
    await expectFinalAnswer(page, /Gloomhaven 2e resolves poison/);
  });

  test('keeps work log expanded while running and collapses it after completion', async ({
    page,
  }) => {
    const releaseStream = await installDelayedDeterministicStream(page, {
      answerText: 'Closed doors block line-of-sight for looting.',
      finalHtml:
        '<p>Closed doors block line-of-sight for looting. <a class="cite" href="https://example.test/frosthaven-rulebook">Rulebook p. 79</a></p>',
      consultedSources: ['RULEBOOK'],
    });
    await loginAsDevUser(page);

    await askQuestionAndCapturePayload(page, 'Can I loot through a closed door?');

    const latestAnswer = page.locator('[data-testid="answer-turn"]').last();
    const workLog = latestAnswer.locator('[data-testid="answer-progress"]');
    await expect(workLog).toBeVisible();
    await expect(workLog).toHaveAttribute('data-work-state', 'running');
    await expect(workLog).toHaveAttribute('open', '');
    await expect(workLog.getByRole('button')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('squire.progressVisibility')))
      .toBeNull();

    releaseStream();

    await expectFinalAnswer(page, /Closed doors block line-of-sight/);
    await expect(workLog).toHaveAttribute('data-work-state', 'complete');
    await expect(workLog).not.toHaveAttribute('open', '');
    await expect(workLog).toContainText('Checked 1 source');
    await expect(workLog.locator('.squire-answer-work__row-label')).toHaveCount(0);
    await expect(workLog.locator('.squire-answer-work__row-detail')).toContainText(
      'Checked rulebook',
    );
  });
});
