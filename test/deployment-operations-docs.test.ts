import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('deployment operations documentation', () => {
  it('provides a production operations guide with the landed deploy and edge path', async () => {
    const guide = await readProjectFile('docs/runbooks/production-operations.md');

    for (const expected of [
      '# Production operations guide',
      'https://squire.maz.org',
      'https://maz-squire.fly.dev',
      'Route 53',
      'CloudFront',
      'AWS WAF',
      'ORIGIN_SHARED_SECRET',
      'Trusted client IPs',
      'X-Forwarded-For',
      'X-Real-IP',
      'Deploy to Fly',
      'gh run list --workflow "Deploy to Fly" --branch main --limit 5',
      "gh api 'repos/maz-org/squire/deployments?environment=production'",
      'flyctl status -a maz-squire',
      'fly releases -a maz-squire --image',
      'node scripts/check-deploy-health.ts --base-url https://maz-squire.fly.dev',
      'curl -I https://squire.maz.org',
      'curl https://squire.maz.org/api/health',
      "q=1' OR '1'='1",
      'https://maz-squire.fly.dev/login',
      'Sign in with Google',
      'one real rules question',
      'LangSmith',
      'env:production',
      'Troubleshoot a production report',
      'metadata.conversationId',
      'metadata.thread_id',
      'metadata.userMessageId',
      'metadata.requestId',
      'X-Request-ID',
      'fly deploy --image <prior-image>',
    ]) {
      expect(guide).toContain(expected);
    }

    expect(guide).not.toContain('Cloudflare WAF');
  });

  it('documents the Sentry and LangSmith production debugging workflow', async () => {
    const guide = await readProjectFile('docs/runbooks/production-operations.md');
    const observability = await readProjectFile('docs/runbooks/observability.md');
    const bugReporting = await readProjectFile('docs/agent/bug-reporting.md');

    expect(guide).toContain('[observability.md](observability.md)');

    for (const expected of [
      '# Squire Observability Runbook',
      'Sentry owns app observability',
      'LangSmith owns LLM traces and eval debugging',
      'Start in Sentry',
      'Start in LangSmith',
      'User Report To Linear',
      'Bad Answer',
      'Stream Or Chat Failure',
      'Browser Or UI Report',
      'Backend, Cron, And Uptime',
      'Safe Test Cases',
      'collectDiagnosticBundle()',
      'createLinearBugReportBody()',
      'environment:production failure_kind:assistant_turn level:error',
      'environment:production surface:browser event_type:stream_error',
      'environment:production job_kind:cron level:error',
      'https://squire.maz.org/api/__sentry-uptime-test-404',
      'fly ssh console -a maz-squire -C',
      'npm run sentry:test-event -- --kind chat --dry-run',
      'unavailable',
    ]) {
      expect(observability).toContain(expected);
    }

    for (const requiredEvidenceField of [
      'Conversation',
      'Turn',
      'Request',
      'Sentry Issue/Event/Replay',
      'Release',
      'Environment',
      'LangSmith Trace/Thread/Run',
      'Observed',
      'Expected',
      'Likely failing area',
      'First files to inspect',
      'Repro',
      'Acceptance',
    ]) {
      expect(observability).toContain(requiredEvidenceField);
    }

    expect(bugReporting).toContain('SQR-298');
    expect(bugReporting).toContain('SQR-299');
  });

  it('keeps current architecture docs on AWS WAF and GitHub-driven Fly deploys', async () => {
    const architecture = await readProjectFile('docs/ARCHITECTURE.md');
    const adr = await readProjectFile('docs/adr/0016-phase-1-hosting-platform.md');
    const spec = await readProjectFile('docs/SPEC.md');

    for (const doc of [architecture, adr, spec]) {
      expect(doc).toContain('AWS WAF');
      expect(doc).toContain('CloudFront');
    }

    expect(architecture).toContain('Route 53');
    expect(architecture).toContain('Deploy to Fly');
    expect(architecture).toContain('flyctl deploy -a maz-squire --remote-only');
    expect(architecture).not.toContain('Cloudflare sits in front as the WAF');
    expect(architecture).not.toContain('- Cloudflare WAF:');

    expect(adr).toContain('SQR-58 (AWS WAF + CloudFront)');
    expect(adr).toContain('actions/create-github-app-token@v3');
    expect(adr).not.toContain('SQR-58 (Cloudflare WAF)');
    expect(adr).not.toContain('setup-flyctl@master');

    const phaseOneSection = spec.slice(
      spec.indexOf('### Phase 1: MVP'),
      spec.indexOf('### Phase 2:'),
    );
    expect(phaseOneSection).toContain('AWS WAF');
    expect(phaseOneSection).not.toContain('Cloudflare WAF');
  });

  it('documents production and eval variables without conflating them', async () => {
    const envExample = await readProjectFile('.env.example');
    const development = await readProjectFile('docs/DEVELOPMENT.md');
    const guide = await readProjectFile('docs/runbooks/production-operations.md');

    for (const expected of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'SESSION_SECRET',
      'SQUIRE_ALLOWED_EMAILS',
      'SQUIRE_ENV=development',
      'LANGSMITH_API_KEY',
      'LANGSMITH_PROJECT',
      'ORIGIN_SHARED_SECRET',
      'REDIS_URL',
    ]) {
      expect(envExample).toContain(expected);
    }

    expect(development).toContain('LANGSMITH_API_KEY');
    expect(development).toContain('SQUIRE_ENV=development');

    expect(guide).toContain('app-runtime secrets');
    expect(guide).toContain('eval/developer-only');
    expect(guide).toContain(
      '`SQUIRE_ENV` is the single source for the LangSmith environment label',
    );
    expect(development).toContain('OAuth bearer auth');
  });
});
