import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SENTRY_ORG_SLUG,
  DEFAULT_SENTRY_PROJECT_SLUG,
  buildSentryRelayPiiConfig,
  buildSentryScrubbingProjectSettings,
  buildSentryScrubbingRuleSpecs,
} from '../scripts/sentry-scrubbing-config.ts';

describe('Sentry scrubbing config', () => {
  it('targets the Fly-provisioned Squire Sentry project', () => {
    expect(DEFAULT_SENTRY_ORG_SLUG).toBe('brian-moseley');
    expect(DEFAULT_SENTRY_PROJECT_SLUG).toBe('maz-squire');
  });

  it('enables project-level scrubbing and IP removal', () => {
    const settings = buildSentryScrubbingProjectSettings();

    expect(settings.dataScrubber).toBe(true);
    expect(settings.dataScrubberDefaults).toBe(true);
    expect(settings.scrubIPAddresses).toBe(true);
    expect(JSON.parse(settings.relayPiiConfig)).toEqual(buildSentryRelayPiiConfig());
  });

  it('covers events, logs, and spans with stable Sentry selectors', () => {
    const config = buildSentryRelayPiiConfig();

    for (const selector of [
      '$message',
      '$error.value',
      'extra.**',
      'contexts.squire.context.**',
      '$log.body',
      '$span.description',
      '$span.data.**',
    ]) {
      expect(config.applications[selector]?.length).toBeGreaterThan(0);
    }

    for (const selector of [
      "$log.attributes.'rawPrompt'.value",
      "$log.attributes.'modelOutput'.value",
      "$log.attributes.'retrievedPassages'.value",
      "$span.data.'gen_ai.prompt'",
      "$span.data.'gen_ai.completion'",
      '$span.data.providerPayload',
      '$http.headers.authorization',
      '$http.data',
      '$user.email',
      '$user.geo.**',
      'contexts.squire.context.request.body',
      'contexts.squire.context.response.body',
    ]) {
      const ruleIds = config.applications[selector] ?? [];
      expect(ruleIds).toHaveLength(1);
      expect(config.rules[ruleIds[0] ?? '']).toEqual({
        type: 'anything',
        redaction: { method: 'remove' },
      });
    }
  });

  it('keeps custom string rules focused on PII-shaped values', () => {
    const specs = buildSentryScrubbingRuleSpecs();

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '$message', type: 'email', method: 'mask' }),
        expect.objectContaining({ source: '$message', type: 'ip', method: 'remove' }),
        expect.objectContaining({ source: '$message', type: 'password', method: 'remove' }),
        expect.objectContaining({
          source: '$message',
          type: 'pattern',
          method: 'replace',
          pattern: expect.stringContaining('Bearer'),
        }),
        expect.objectContaining({
          source: '$log.body',
          type: 'pattern',
          method: 'replace',
          pattern: expect.stringContaining('access_token'),
        }),
      ]),
    );
  });

  it('does not include committed Sentry credentials or DSNs', () => {
    const serialized = JSON.stringify(buildSentryScrubbingProjectSettings());

    expect(serialized).not.toContain('SENTRY_TOKEN');
    expect(serialized).not.toContain('sntryu_');
    expect(serialized).not.toContain('sentry.io/');
    expect(serialized).not.toContain('SENTRY_DSN');
  });
});
