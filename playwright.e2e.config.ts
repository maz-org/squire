import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number.parseInt(process.env.SQUIRE_E2E_PORT ?? '4512', 10);
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65535) {
  throw new Error('SQUIRE_E2E_PORT must be an integer between 1 and 65535');
}

const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run serve',
    url: `${baseURL}/api/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SQUIRE_DEV_LOGIN: '1',
      PORT: String(e2ePort),
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? 'squire-e2e-session-secret-32-characters-minimum',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'squire-e2e-anthropic-key',
      GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? 'squire-e2e-google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET:
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? 'squire-e2e-google-client-secret',
      LANGSMITH_TRACING: process.env.LANGSMITH_TRACING ?? 'false',
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile-table',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
  ],
});
