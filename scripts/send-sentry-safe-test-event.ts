import * as Sentry from '@sentry/node';

import {
  captureTelemetryError,
  captureTelemetryLog,
  captureTelemetryMessage,
  flushTelemetry,
  initTelemetry,
} from '../src/telemetry.ts';

const SAFE_TEST_KINDS = [
  'backend',
  'chat',
  'browser',
  'cron',
  'deploy-regression',
  'scrub-canary',
] as const;

type SafeTestKind = (typeof SAFE_TEST_KINDS)[number];

const SAFE_TEST_ERROR_NAMES: Record<Exclude<SafeTestKind, 'browser'>, string> = {
  backend: 'SquireSafeBackendAlertTest',
  chat: 'SquireSafeChatAlertTest',
  cron: 'SquireSafeCronAlertTest',
  'deploy-regression': 'SquireSafeDeployRegressionAlertTest',
  'scrub-canary': 'SquireSafeScrubCanary',
};

interface ParsedArgs {
  kind: SafeTestKind;
  dryRun: boolean;
}

function usage(): string {
  return `Usage: node scripts/send-sentry-safe-test-event.ts --kind <${SAFE_TEST_KINDS.join('|')}> [--dry-run]`;
}

function parseArgs(argv: string[]): ParsedArgs {
  let kind: SafeTestKind | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--kind') {
      const value = argv[index + 1];
      if (!SAFE_TEST_KINDS.includes(value as SafeTestKind)) {
        throw new Error(usage());
      }
      kind = value as SafeTestKind;
      index += 1;
      continue;
    }
    throw new Error(usage());
  }

  if (!kind) throw new Error(usage());
  return { kind, dryRun };
}

function safeTestInput(kind: SafeTestKind) {
  const requestId = `sentry-test-${kind}`;
  const conversationId = 'sentry-test-conversation';
  const userMessageId = 'sentry-test-user-message';

  switch (kind) {
    case 'backend':
      return {
        route: '/__sentry-test/backend',
        requestId,
        context: {
          surface: 'server',
          eventType: 'safe_test',
        },
      };
    case 'chat':
      return {
        route: '/chat/sentry-test-conversation/messages/sentry-test-user-message/stream',
        requestId,
        conversationId,
        userMessageId,
        context: {
          surface: 'chat_sse',
          failureKind: 'assistant_turn',
          eventType: 'safe_test',
        },
      };
    case 'browser':
      return {
        route: '/chat/sentry-test-conversation',
        requestId,
        conversationId,
        userMessageId,
        context: {
          surface: 'browser',
          eventType: 'browser_error',
          maskedReplay: {
            textMasked: true,
            attributesMasked: true,
            turns: { assistantTurnCount: 1, errorBannerCount: 1 },
          },
        },
      };
    case 'cron':
      return {
        route: '/scripts/sweep-expired-sessions',
        requestId,
        context: {
          scriptName: 'sweep-expired-sessions',
          scriptKind: 'cron',
          eventType: 'safe_test',
        },
      };
    case 'deploy-regression':
      return {
        route: '/__sentry-test/deploy-regression',
        requestId,
        context: {
          surface: 'server',
          eventType: 'deploy_regression_test',
        },
      };
    case 'scrub-canary':
      return {
        route: '/__sentry-test/scrub-canary',
        requestId,
        conversationId,
        userMessageId,
        context: {
          surface: 'server',
          eventType: 'scrub_canary',
          emailAddress: 'sentry-scrub-canary@example.invalid',
          phoneNumber: '+1 415 555 0100',
          customerName: 'Sentry Scrub Canary',
          authorization: 'Bearer sentry_scrub_canary_token_1234567890',
          rawPrompt: 'Synthetic prompt text for scrubbing verification',
          modelOutput: 'Synthetic model output for scrubbing verification',
          providerPayload: { body: 'Synthetic provider payload for scrubbing verification' },
          retrievedPassages: ['Synthetic retrieved source passage for scrubbing verification'],
          request: {
            body: {
              prompt: 'Synthetic request body prompt for scrubbing verification',
            },
          },
        },
      };
  }
}

function scrubCanaryAttributes(): Record<string, unknown> {
  return {
    emailAddress: 'sentry-scrub-canary@example.invalid',
    phoneNumber: '+1 415 555 0100',
    customerName: 'Sentry Scrub Canary',
    authorization: 'Bearer sentry_scrub_canary_token_1234567890',
    rawPrompt: 'Synthetic prompt text for log scrubbing verification',
    modelOutput: 'Synthetic model output for log scrubbing verification',
    providerPayload: { body: 'Synthetic provider payload for log scrubbing verification' },
    retrievedPassages: ['Synthetic retrieved source passage for log scrubbing verification'],
    request_body: {
      prompt: 'Synthetic request body prompt for log scrubbing verification',
    },
  };
}

function emitScrubCanaryTrace(): boolean {
  try {
    Sentry.startSpan(
      {
        name: 'squire.safe_scrub_canary',
        op: 'squire.scrub_canary',
        attributes: {
          'gen_ai.prompt': 'Synthetic prompt text for span scrubbing verification',
          'gen_ai.completion': 'Synthetic model output for span scrubbing verification',
          providerPayload: 'Synthetic provider payload for span scrubbing verification',
          retrievedPassages: 'Synthetic retrieved source passage for span scrubbing verification',
          emailAddress: 'sentry-scrub-canary@example.invalid',
          phoneNumber: '+1 415 555 0100',
          authorization: 'Bearer sentry_scrub_canary_token_1234567890',
        },
      },
      () => undefined,
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = safeTestInput(args.kind);

  if (args.dryRun) {
    console.log(JSON.stringify({ kind: args.kind, input }, null, 2));
    return;
  }

  const init = initTelemetry();
  if (!init.enabled) {
    throw new Error(`Sentry telemetry is not enabled: ${init.reason}`);
  }

  const eventId =
    args.kind === 'browser'
      ? captureTelemetryMessage('browser.browser_error', 'error', input)
      : captureTelemetryError(new Error(SAFE_TEST_ERROR_NAMES[args.kind]), input);
  const logSent =
    args.kind === 'scrub-canary'
      ? captureTelemetryLog('warn', 'sentry scrub canary synthetic alice@example.invalid', {
          ...input,
          attributes: scrubCanaryAttributes(),
        })
      : false;
  const traceAttempted = args.kind === 'scrub-canary' ? emitScrubCanaryTrace() : false;
  await flushTelemetry(2_000);
  console.log(JSON.stringify({ kind: args.kind, eventId, logSent, traceAttempted }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
