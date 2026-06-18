import {
  captureTelemetryError,
  type TelemetryCaptureInput,
  type TelemetryUserIdentity,
} from '../telemetry.ts';

export type ChatTelemetrySurface = 'web_chat' | 'chat_sse' | 'api_ask';

export interface ChatFailureTelemetryInput {
  surface: ChatTelemetrySurface;
  failureKind: 'assistant_turn' | 'api_ask';
  route?: string;
  requestId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  user?: TelemetryUserIdentity;
  game?: string | null;
  context?: Record<string, unknown>;
}

function originalErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'Error';
  const name = error.name.trim();
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name) ? name : 'Error';
}

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate =
    (error as { code?: unknown }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
  if (typeof candidate !== 'string') return undefined;

  const code = candidate.trim();
  return /^[A-Z0-9_:-]{1,64}$/.test(code) ? code : undefined;
}

function safeChatFailureError(error: unknown): Error {
  const safe = new Error('Squire chat failure');
  safe.name = `ChatFailure:${originalErrorName(error)}`;
  return safe;
}

export function captureChatFailureTelemetry(
  error: unknown,
  input: ChatFailureTelemetryInput,
): void {
  const context = {
    ...(input.context ?? {}),
    surface: input.surface,
    failureKind: input.failureKind,
    game: input.game ?? null,
    originalErrorName: originalErrorName(error),
    ...(safeErrorCode(error) ? { originalErrorCode: safeErrorCode(error) } : {}),
  };

  const telemetryInput: TelemetryCaptureInput = {
    route: input.route,
    requestId: input.requestId,
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    user: input.user,
    context,
  };

  captureTelemetryError(safeChatFailureError(error), telemetryInput);
}
