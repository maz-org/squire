import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const appCss = readFileSync(new URL('../../src/web-ui/styles.css', import.meta.url), 'utf8');

function renderReloadedConversationFixture(): string {
  const longAnswerItems = Array.from({ length: 20 }, (_unused, index) => {
    const n = index + 1;
    return `<li>Drifter perk entry ${n} with enough text to wrap into the next line on a phone viewport.</li>`;
  }).join('');

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <style>${appCss}</style>
      </head>
      <body class="squire-body">
        <header class="squire-header">
          <span class="squire-monogram" aria-hidden="true"></span>
          <span class="squire-wordmark">Squire</span>
          <span class="squire-context">GH2 TABLETOP CAMPAIGN</span>
        </header>
        <div class="squire-frame">
          <div class="squire-column">
            <main id="squire-surface" class="squire-surface" aria-live="off" aria-atomic="true">
              <section class="squire-transcript" data-testid="conversation-transcript" role="log" aria-live="polite">
                <article class="squire-turn">
                  <h2 class="squire-question">what perks does the drifter have?</h2>
                </article>
                <article class="squire-turn squire-answer squire-markdown" data-testid="answer-turn">
                  <details class="squire-answer-work">
                    <summary class="squire-answer-work__summary">Worked for 0s</summary>
                  </details>
                  <div class="squire-answer__content squire-markdown" data-testid="answer-content">
                    <p>Here are the Drifter's perks from the character mat:</p>
                    <ol>${longAnswerItems}</ol>
                    <p>That's 13 perk entries in total, with the +1 card appearing twice as separate perks.</p>
                  </div>
                </article>
              </section>
            </main>
            <div class="squire-composer">
              <form class="squire-input-dock" method="post" action="/chat/conversation-123/messages">
                <textarea
                  id="squire-input"
                  name="question"
                  rows="3"
                  autocomplete="off"
                  placeholder="Ask about a rule, card, item, monster, or scenario"
                ></textarea>
                <button type="submit" class="squire-input-dock__submit" aria-label="Ask"></button>
              </form>
            </div>
          </div>
        </div>
      </body>
    </html>`;
}

test.describe('SQR-297 mobile transcript layout', () => {
  test('scrolls a reloaded transcript and ask widget as one column at phone size', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'static phone layout check only needs one browser',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(renderReloadedConversationFixture());

    const geometry = await page.evaluate(() => {
      const column = document.querySelector('.squire-column');
      const surface = document.querySelector('.squire-surface');
      const dock = document.querySelector('.squire-input-dock');
      if (
        !(column instanceof HTMLElement) ||
        !(surface instanceof HTMLElement) ||
        !(dock instanceof HTMLElement)
      ) {
        throw new Error('missing Squire transcript fixture elements');
      }

      const columnStyle = window.getComputedStyle(column);
      const surfaceRect = surface.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const surfaceStyle = window.getComputedStyle(surface);

      return {
        columnClientHeight: column.clientHeight,
        columnOverflowY: columnStyle.overflowY,
        columnScrollHeight: column.scrollHeight,
        dockOffsetTop: dock.offsetTop,
        dockTopBeforeScroll: dockRect.top,
        surfaceHeight: surfaceRect.height,
        surfaceClientHeight: surface.clientHeight,
        surfaceOverflowY: surfaceStyle.overflowY,
        surfaceScrollHeight: surface.scrollHeight,
      };
    });

    expect(geometry.columnOverflowY).toBe('auto');
    expect(geometry.columnScrollHeight).toBeGreaterThan(geometry.columnClientHeight);
    expect(geometry.surfaceOverflowY).toBe('visible');
    expect(geometry.surfaceScrollHeight).toBeLessThanOrEqual(geometry.surfaceClientHeight + 1);
    expect(geometry.dockOffsetTop).toBeGreaterThanOrEqual(geometry.surfaceHeight - 1);
    expect(geometry.dockTopBeforeScroll).toBeGreaterThan(geometry.columnClientHeight);

    const afterScroll = await page.evaluate(() => {
      const column = document.querySelector('.squire-column');
      const dock = document.querySelector('.squire-input-dock');
      if (column instanceof HTMLElement) {
        column.scrollTop = column.scrollHeight - column.clientHeight;
      }
      if (!(dock instanceof HTMLElement)) {
        throw new Error('missing Squire input dock after scroll');
      }
      const dockRect = dock.getBoundingClientRect();
      return {
        dockBottom: dockRect.bottom,
        dockTop: dockRect.top,
        viewportHeight: window.innerHeight,
      };
    });

    expect(afterScroll.dockTop).toBeLessThan(afterScroll.viewportHeight);
    expect(afterScroll.dockBottom).toBeLessThanOrEqual(afterScroll.viewportHeight + 1);
  });
});
