import {
  SENTRY_USAGE_DASHBOARD_QUERIES,
  SENTRY_USAGE_GUARDRAIL_ACTIONS,
  SENTRY_USAGE_GUARDRAILS_AS_OF,
  SENTRY_USAGE_GUARDRAILS_SOURCES,
  SENTRY_USAGE_PRICING_SNAPSHOT,
} from './sentry-usage-guardrails-config.ts';

function main(): void {
  if (process.argv.length > 2) {
    throw new Error('Usage: node scripts/print-sentry-usage-guardrails.ts');
  }

  console.log(
    JSON.stringify(
      {
        asOf: SENTRY_USAGE_GUARDRAILS_AS_OF,
        sources: SENTRY_USAGE_GUARDRAILS_SOURCES,
        pricing: SENTRY_USAGE_PRICING_SNAPSHOT,
        queries: SENTRY_USAGE_DASHBOARD_QUERIES,
        guardrails: SENTRY_USAGE_GUARDRAIL_ACTIONS,
      },
      null,
      2,
    ),
  );
}

main();
