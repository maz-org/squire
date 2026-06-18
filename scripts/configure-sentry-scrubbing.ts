import {
  DEFAULT_SENTRY_ORG_SLUG,
  DEFAULT_SENTRY_PROJECT_SLUG,
  buildSentryRelayPiiConfig,
  buildSentryScrubbingProjectSettings,
} from './sentry-scrubbing-config.ts';
import { SentryAdminClient } from './sentry-admin-client.ts';

type Mode = 'dry-run' | 'apply' | 'verify';

interface ParsedArgs {
  mode: Mode;
  orgSlug: string;
  projectSlug: string;
}

interface SentryProjectPrivacySettings {
  dataScrubber?: boolean;
  dataScrubberDefaults?: boolean;
  scrubIPAddresses?: boolean;
  relayPiiConfig?: string | null;
}

function usage(): string {
  return [
    'Usage: node scripts/configure-sentry-scrubbing.ts [--dry-run|--apply|--verify]',
    '       [--org <slug>] [--project <slug>]',
  ].join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: Mode = 'dry-run';
  let orgSlug = DEFAULT_SENTRY_ORG_SLUG;
  let projectSlug = DEFAULT_SENTRY_PROJECT_SLUG;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      mode = 'dry-run';
      continue;
    }
    if (arg === '--apply') {
      mode = 'apply';
      continue;
    }
    if (arg === '--verify') {
      mode = 'verify';
      continue;
    }
    if (arg === '--org') {
      orgSlug = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--project') {
      projectSlug = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new Error(usage());
  }

  if (!orgSlug || !projectSlug) throw new Error(usage());
  return { mode, orgSlug, projectSlug };
}

function readSentryToken(): string {
  const token = process.env.SENTRY_TOKEN?.trim();
  if (!token) {
    throw new Error('SENTRY_TOKEN is required for --apply and --verify');
  }
  return token;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseRelayPiiConfig(value: string | null | undefined): unknown {
  if (!value) return null;
  return JSON.parse(value);
}

function verifyProjectSettings(project: SentryProjectPrivacySettings): string[] {
  const expected = buildSentryScrubbingProjectSettings();
  const issues: string[] = [];

  if (project.dataScrubber !== expected.dataScrubber) {
    issues.push('dataScrubber is not enabled');
  }
  if (project.dataScrubberDefaults !== expected.dataScrubberDefaults) {
    issues.push('dataScrubberDefaults is not enabled');
  }
  if (project.scrubIPAddresses !== expected.scrubIPAddresses) {
    issues.push('scrubIPAddresses is not enabled');
  }

  const actualRelayConfig = parseRelayPiiConfig(project.relayPiiConfig);
  const expectedRelayConfig = buildSentryRelayPiiConfig();
  if (canonicalJson(actualRelayConfig) !== canonicalJson(expectedRelayConfig)) {
    issues.push('relayPiiConfig does not match the checked-in Squire rules');
  }

  return issues;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = `/projects/${args.orgSlug}/${args.projectSlug}/`;
  const payload = buildSentryScrubbingProjectSettings();

  if (args.mode === 'dry-run') {
    console.log(
      JSON.stringify(
        {
          mode: args.mode,
          orgSlug: args.orgSlug,
          projectSlug: args.projectSlug,
          endpoint,
          payload: {
            ...payload,
            relayPiiConfig: JSON.parse(payload.relayPiiConfig) as unknown,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const token = readSentryToken();
  const sentry = new SentryAdminClient({ token });

  if (args.mode === 'apply') {
    await sentry.request<SentryProjectPrivacySettings>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  const project = await sentry.request<SentryProjectPrivacySettings>(endpoint);
  const issues = verifyProjectSettings(project);
  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        orgSlug: args.orgSlug,
        projectSlug: args.projectSlug,
        ok: issues.length === 0,
        issues,
        observed: {
          dataScrubber: project.dataScrubber,
          dataScrubberDefaults: project.dataScrubberDefaults,
          scrubIPAddresses: project.scrubIPAddresses,
          relayRuleCount: Object.keys(
            (parseRelayPiiConfig(project.relayPiiConfig) as { rules?: Record<string, unknown> })
              ?.rules ?? {},
          ).length,
        },
      },
      null,
      2,
    ),
  );

  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
