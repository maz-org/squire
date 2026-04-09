import { describe, expect, it, vi } from 'vitest';

import {
  buildLaunchAgentPlist,
  shouldInstallLaunchAgent,
} from '../scripts/install-agent-learnings-launchagent.ts';

describe('agent learnings launchagent', () => {
  it('renders a launchd plist with weekly interval and export command', () => {
    const plist = buildLaunchAgentPlist('/Users/bcm/Projects/maz/squire');

    expect(plist).toContain('<string>org.maz.squire.agent-learnings</string>');
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>604800</integer>');
    expect(plist).toContain('npm run agent:export-learnings');
    expect(plist).toContain('/Users/bcm/Projects/maz/squire');
  });

  it('skips install on CI', () => {
    vi.stubEnv('CI', 'true');
    expect(shouldInstallLaunchAgent()).toEqual({
      install: false,
      reason: 'CI environment',
    });
    vi.unstubAllEnvs();
  });
});
