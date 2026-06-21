import { describe, expect, it } from 'vitest';

import {
  renderDashboardProgressEmpty,
  renderDashboardProgressError,
} from '../src/web-ui/campaign-dashboard.ts';

describe('campaign progress renderer states', () => {
  it('renders the empty state without a fake record-progress action', () => {
    const body = String(renderDashboardProgressEmpty());

    expect(body).toContain('<h2 class="squire-campaign-dashboard__section-title">Progress</h2>');
    expect(body).toContain('class="squire-progress-section__lede"');
    expect(body).toContain(
      'Track unlocked, played, skipped, and blocked scenarios for this campaign.',
    );
    expect(body).toContain('class="squire-campaign-dashboard__placeholder"');
    expect(body).toContain('No scenario progress is available for this campaign yet.');
    expect(body).not.toContain('Record progress');
  });

  it('renders a retryable progress error without exposing details', () => {
    const body = String(renderDashboardProgressError('campaign-1'));

    expect(body).toContain('COULD NOT LOAD');
    expect(body).toContain(
      'Track unlocked, played, skipped, and blocked scenarios for this campaign.',
    );
    expect(body).toContain('Progress is unavailable right now.');
    expect(body).toContain('href="/campaigns/campaign-1"');
    expect(body).toContain('Retry');
    expect(body).not.toContain('Error:');
  });
});
