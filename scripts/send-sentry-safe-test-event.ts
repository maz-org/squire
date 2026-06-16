import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { trace, type Attributes } from '@opentelemetry/api';

import {
  captureTelemetryError,
  captureTelemetryLog,
  captureTelemetryMessage,
  initTelemetry,
  sentryTraceSampleRateFromEnv,
} from '../src/telemetry.ts';
import { runScriptWithTelemetry } from '../src/script-telemetry.ts';
import {
  SENTRY_APP_HEALTH_ENVIRONMENT,
  SENTRY_APP_HEALTH_ORG,
  SENTRY_APP_HEALTH_PROJECT_ID,
} from './sentry-app-health-config.ts';

export const SAFE_TEST_KINDS = [
  'backend',
  'chat',
  'browser',
  'cron',
  'uptime',
  'deploy-regression',
  'scrub-canary',
] as const;

type SafeTestKind = (typeof SAFE_TEST_KINDS)[number];
type SafeVerificationKind = Exclude<SafeTestKind, 'scrub-canary'>;
type TraceSearchable = true | false | null;

interface SafeTraceProof {
  traceAttempted: boolean;
  traceSpanStarted: boolean;
  traceSearchable: TraceSearchable;
  traceSearchableReason: string;
  traceId: string | null;
  spanId: string | null;
}

export const SAFE_VERIFICATION_KINDS = [
  'backend',
  'chat',
  'browser',
  'cron',
  'uptime',
  'deploy-regression',
] as const satisfies readonly SafeVerificationKind[];

const SAFE_TEST_ERROR_NAMES: Record<SafeTestKind, string> = {
  backend: 'SquireSafeBackendAlertTest',
  chat: 'SquireSafeChatAlertTest',
  browser: 'SquireSafeBrowserAlertTest',
  cron: 'SquireSafeCronAlertTest',
  uptime: 'SquireSafeUptimeVerificationTest',
  'deploy-regression': 'SquireSafeDeployRegressionAlertTest',
  'scrub-canary': 'SquireSafeScrubCanary',
};

const SENTRY_ORG_URL = `https://${SENTRY_APP_HEALTH_ORG}.sentry.io`;

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
    case 'uptime':
      return {
        route: '/api/health',
        requestId,
        context: {
          surface: 'uptime',
          eventType: 'uptime_verification',
          checkSlug: 'production-health',
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
          response: {
            body: {
              answer: 'Synthetic response body answer for scrubbing verification',
            },
          },
        },
      };
  }
}

function isSafeVerificationKind(kind: SafeTestKind): kind is SafeVerificationKind {
  return SAFE_VERIFICATION_KINDS.includes(kind as SafeVerificationKind);
}

function routeFromInput(input: ReturnType<typeof safeTestInput>): string {
  return input.route;
}

function requestIdFromInput(input: ReturnType<typeof safeTestInput>): string {
  return input.requestId;
}

function contextString(input: ReturnType<typeof safeTestInput>, key: string): string | undefined {
  const value = (input.context as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function sentrySearchUrl(path: string, query: string): string {
  const params = new URLSearchParams({
    project: SENTRY_APP_HEALTH_PROJECT_ID,
    environment: SENTRY_APP_HEALTH_ENVIRONMENT,
    query,
    referrer: 'squire-safe-test',
  });
  return `${SENTRY_ORG_URL}/${path}?${params.toString()}`;
}

function sentryEvidence(kind: SafeVerificationKind, input: ReturnType<typeof safeTestInput>) {
  const requestId = requestIdFromInput(input);
  const eventSearchUrl = sentrySearchUrl('issues/', `request_id:${requestId}`);
  const logsSearchUrl = sentrySearchUrl('explore/logs/', `request_id:${requestId}`);
  const traceSearchUrl = sentrySearchUrl('explore/traces/', `squire.request_id:${requestId}`);
  const release = process.env.SENTRY_RELEASE ?? 'unavailable: SENTRY_RELEASE is not set';
  const environment = process.env.SQUIRE_ENV ?? SENTRY_APP_HEALTH_ENVIRONMENT;

  return {
    requestId,
    sentryEventSearchUrl: eventSearchUrl,
    sentryLogsSearchUrl: logsSearchUrl,
    sentryTraceSearchUrl: traceSearchUrl,
    linearEvidence: {
      Conversation:
        'conversationId' in input
          ? input.conversationId
          : 'unavailable: this synthetic path does not use a conversation',
      Turn:
        'userMessageId' in input
          ? input.userMessageId
          : 'unavailable: this synthetic path does not use a turn',
      Request: requestId,
      'Sentry Issue/Event/Replay': `Event search: ${eventSearchUrl}\nLogs: ${logsSearchUrl}\nTrace: ${traceSearchUrl}`,
      Release: release,
      Environment: environment,
      'LangSmith Trace/Thread/Run':
        'unavailable: safe synthetic verification does not create an AI run',
      Observed: `${kind} synthetic app telemetry emitted`,
      Expected:
        'Sentry event and log are searchable by request_id; trace rows require traceProof or manual Sentry confirmation',
      'Likely failing area': `sentry-${kind}`,
      'First files to inspect': 'scripts/send-sentry-safe-test-event.ts; src/telemetry.ts',
      Repro: `fly ssh console -a maz-squire -C 'node scripts/send-sentry-safe-test-event.ts --kind ${kind}'`,
      Acceptance:
        'Copy the event and log search URLs plus either confirmed trace rows or traceProof unavailable reason into Linear evidence',
    },
  };
}

function safeVerificationEvent(kind: SafeVerificationKind) {
  if (kind === 'browser') {
    return {
      type: 'message',
      level: 'error',
      message: 'browser.browser_error',
    };
  }

  return {
    type: 'exception',
    level: 'error',
    errorName: SAFE_TEST_ERROR_NAMES[kind],
  };
}

function safeVerificationLog(kind: SafeVerificationKind, input: ReturnType<typeof safeTestInput>) {
  return {
    level: 'error',
    message: `sentry.safe_test.${kind}`,
    attributes: {
      safe_test_kind: kind,
      status: 'error',
      synthetic: true,
      route: routeFromInput(input),
      event_type: contextString(input, 'eventType') ?? 'safe_test',
      surface: contextString(input, 'surface') ?? kind,
      ...(contextString(input, 'failureKind')
        ? { failure_kind: contextString(input, 'failureKind') }
        : {}),
      ...(contextString(input, 'scriptKind')
        ? { job_kind: contextString(input, 'scriptKind') }
        : {}),
    },
  } as const;
}

function safeVerificationTrace(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
) {
  return {
    name: `squire.safe_test.${kind}`,
    op: 'squire.safe_test',
    attributes: {
      'squire.safe_test.kind': kind,
      'squire.request_id': requestIdFromInput(input),
      'squire.route': routeFromInput(input),
      'squire.synthetic': true,
      'squire.surface': contextString(input, 'surface') ?? kind,
      ...(contextString(input, 'failureKind')
        ? { 'squire.failure_kind': contextString(input, 'failureKind') }
        : {}),
      ...(contextString(input, 'scriptKind')
        ? { 'squire.script_kind': contextString(input, 'scriptKind') }
        : {}),
      ...('conversationId' in input ? { 'squire.conversation_id': input.conversationId } : {}),
      ...('userMessageId' in input ? { 'squire.user_message_id': input.userMessageId } : {}),
    },
  } as const;
}

function safeVerificationTraceAttributes(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
): Attributes {
  return safeVerificationTrace(kind, input).attributes;
}

function sentryTraceDisabledReason(): string | undefined {
  const tracesSampleRate = sentryTraceSampleRateFromEnv(process.env);
  if (tracesSampleRate === undefined) {
    return 'SENTRY_TRACES_SAMPLE_RATE is unset or invalid, so Sentry app-span export is disabled';
  }
  if (tracesSampleRate <= 0) {
    return 'SENTRY_TRACES_SAMPLE_RATE is 0, so Sentry app-span export is disabled';
  }
  return undefined;
}

function dryRunTraceProof(): SafeTraceProof {
  return {
    traceAttempted: false,
    traceSpanStarted: false,
    traceSearchable: null,
    traceSearchableReason:
      'dry-run: telemetry is not sent, so Sentry span searchability is not checked',
    traceId: null,
    spanId: null,
  };
}

function traceProof(input: {
  spanStarted: boolean;
  traceId: string | null;
  spanId: string | null;
  startError?: unknown;
}): SafeTraceProof {
  const disabledReason = sentryTraceDisabledReason();
  if (disabledReason) {
    return {
      traceAttempted: false,
      traceSpanStarted: input.spanStarted,
      traceSearchable: false,
      traceSearchableReason: `unavailable: ${disabledReason}`,
      traceId: input.traceId,
      spanId: input.spanId,
    };
  }

  if (input.startError) {
    return {
      traceAttempted: true,
      traceSpanStarted: input.spanStarted,
      traceSearchable: false,
      traceSearchableReason: `unavailable: OpenTelemetry span start failed: ${
        input.startError instanceof Error ? input.startError.message : String(input.startError)
      }`,
      traceId: input.traceId,
      spanId: input.spanId,
    };
  }

  if (!input.spanStarted) {
    return {
      traceAttempted: true,
      traceSpanStarted: false,
      traceSearchable: false,
      traceSearchableReason: 'unavailable: OpenTelemetry did not start a local span',
      traceId: input.traceId,
      spanId: input.spanId,
    };
  }

  return {
    traceAttempted: true,
    traceSpanStarted: true,
    traceSearchable: null,
    traceSearchableReason:
      'unavailable: OpenTelemetry span was emitted, but this script does not query Sentry after ingestion; confirm rows with sentryTraceSearchUrl',
    traceId: input.traceId,
    spanId: input.spanId,
  };
}

function safeVerificationDryRun(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
) {
  return {
    kind,
    input,
    event: safeVerificationEvent(kind),
    log: safeVerificationLog(kind, input),
    trace: safeVerificationTrace(kind, input),
    traceProof: dryRunTraceProof(),
    evidence: sentryEvidence(kind, input),
  };
}

export function safeVerificationDryRunPayload(kind: SafeVerificationKind) {
  return safeVerificationDryRun(kind, safeTestInput(kind));
}

function captureSafeVerificationEvent(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
): string | null {
  if (kind === 'browser') {
    return captureTelemetryMessage('browser.browser_error', 'error', input);
  }
  return captureTelemetryError(new Error(SAFE_TEST_ERROR_NAMES[kind]), input);
}

function emitSafeVerificationTrace(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
  operation: () => void,
): SafeTraceProof {
  let operationRan = false;
  let spanStarted = false;
  let traceId: string | null = null;
  let spanId: string | null = null;
  const runOperationOnce = () => {
    if (operationRan) return;
    operationRan = true;
    operation();
  };

  try {
    trace
      .getTracer('squire.safe-test')
      .startActiveSpan(
        safeVerificationTrace(kind, input).name,
        { attributes: safeVerificationTraceAttributes(kind, input) },
        (span) => {
          spanStarted = true;
          const context = span.spanContext();
          traceId = context.traceId;
          spanId = context.spanId;
          try {
            runOperationOnce();
          } finally {
            span.end();
          }
        },
      );
    return traceProof({ spanStarted, traceId, spanId });
  } catch (error: unknown) {
    console.error(
      'safe verification trace skipped:',
      error instanceof Error ? error.message : String(error),
    );
    runOperationOnce();
    return traceProof({ spanStarted, traceId, spanId, startError: error });
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
    response_body: {
      answer: 'Synthetic response body answer for log scrubbing verification',
    },
  };
}

function emitScrubCanaryTrace(): SafeTraceProof {
  let spanStarted = false;
  let traceId: string | null = null;
  let spanId: string | null = null;
  try {
    trace.getTracer('squire.safe-test').startActiveSpan(
      'squire.safe_scrub_canary',
      {
        attributes: {
          'gen_ai.prompt': 'Synthetic prompt text for span scrubbing verification',
          'gen_ai.completion': 'Synthetic model output for span scrubbing verification',
          providerPayload: 'Synthetic provider payload for span scrubbing verification',
          retrievedPassages: 'Synthetic retrieved source passage for span scrubbing verification',
          'request.body': 'Synthetic request body for span scrubbing verification',
          'response.body': 'Synthetic response body for span scrubbing verification',
          emailAddress: 'sentry-scrub-canary@example.invalid',
          phoneNumber: '+1 415 555 0100',
          authorization: 'Bearer sentry_scrub_canary_token_1234567890',
        },
      },
      (span) => {
        spanStarted = true;
        const context = span.spanContext();
        traceId = context.traceId;
        spanId = context.spanId;
        span.end();
      },
    );
    return traceProof({ spanStarted, traceId, spanId });
  } catch (error: unknown) {
    console.error(
      'scrub-canary trace skipped:',
      error instanceof Error ? error.message : String(error),
    );
    return traceProof({ spanStarted, traceId, spanId, startError: error });
  }
}

function scriptTelemetryOptions(kind: SafeTestKind, input: ReturnType<typeof safeTestInput>) {
  return {
    scriptName: 'send-sentry-safe-test-event',
    scriptKind: kind === 'cron' ? ('cron' as const) : ('script' as const),
    route: routeFromInput(input),
    requestId: requestIdFromInput(input),
    flushTimeoutMs: 2_000,
  };
}

function serializeTraceProof(proof: SafeTraceProof) {
  return {
    traceAttempted: proof.traceAttempted,
    traceSpanStarted: proof.traceSpanStarted,
    traceSearchable: proof.traceSearchable,
    traceSearchableReason: proof.traceSearchableReason,
    traceId: proof.traceId,
    spanId: proof.spanId,
  };
}

function scrubCanaryDryRun(kind: SafeTestKind, input: ReturnType<typeof safeTestInput>) {
  return {
    kind,
    input,
    traceProof: dryRunTraceProof(),
  };
}

async function emitSafeVerification(
  kind: SafeVerificationKind,
  input: ReturnType<typeof safeTestInput>,
) {
  return runScriptWithTelemetry(
    async () => {
      let eventId: string | null = null;
      let logSent = false;
      const traceProofResult = emitSafeVerificationTrace(kind, input, () => {
        eventId = captureSafeVerificationEvent(kind, input);
        const log = safeVerificationLog(kind, input);
        logSent = captureTelemetryLog(log.level, log.message, {
          ...input,
          attributes: log.attributes,
        });
      });

      return {
        kind,
        eventId,
        logSent,
        ...serializeTraceProof(traceProofResult),
        traceProof: traceProofResult,
        evidence: sentryEvidence(kind, input),
      };
    },
    scriptTelemetryOptions(kind, input),
  );
}

async function emitScrubCanary(input: ReturnType<typeof safeTestInput>, kind: SafeTestKind) {
  return runScriptWithTelemetry(
    async () => {
      const eventId = captureTelemetryError(new Error(SAFE_TEST_ERROR_NAMES[kind]), input);
      const logSent = captureTelemetryLog(
        'warn',
        'sentry scrub canary synthetic alice@example.invalid',
        {
          ...input,
          attributes: {
            ...scrubCanaryAttributes(),
          },
        },
      );
      const traceProofResult = emitScrubCanaryTrace();
      return {
        kind,
        eventId,
        logSent,
        ...serializeTraceProof(traceProofResult),
        traceProof: traceProofResult,
      };
    },
    scriptTelemetryOptions(kind, input),
  );
}

function dryRunPayload(kind: SafeTestKind, input: ReturnType<typeof safeTestInput>) {
  return isSafeVerificationKind(kind)
    ? safeVerificationDryRun(kind, input)
    : scrubCanaryDryRun(kind, input);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = safeTestInput(args.kind);

  if (args.dryRun) {
    console.log(JSON.stringify(dryRunPayload(args.kind, input), null, 2));
    return;
  }

  const init = initTelemetry();
  if (!init.enabled) {
    throw new Error(`Sentry telemetry is not enabled: ${init.reason}`);
  }

  if (isSafeVerificationKind(args.kind)) {
    console.log(JSON.stringify(await emitSafeVerification(args.kind, input), null, 2));
    return;
  }

  console.log(JSON.stringify(await emitScrubCanary(input, args.kind), null, 2));
}

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(resolve(entrypoint)).href : false;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
