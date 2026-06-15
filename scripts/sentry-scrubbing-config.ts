export const DEFAULT_SENTRY_ORG_SLUG = 'brian-moseley';
export const DEFAULT_SENTRY_PROJECT_SLUG = 'maz-squire';

export type SentryPiiRuleType =
  | 'anything'
  | 'creditcard'
  | 'email'
  | 'ip'
  | 'password'
  | 'pattern'
  | 'pemkey'
  | 'url_auth'
  | 'us_ssn'
  | 'userpath';

export type SentryPiiRedactionMethod = 'mask' | 'remove' | 'replace';

export interface SentryPiiRule {
  type: SentryPiiRuleType;
  redaction: {
    method: SentryPiiRedactionMethod;
    text?: string;
  };
  pattern?: string;
  replaceGroups?: number[];
}

export interface SentryRelayPiiConfig {
  rules: Record<string, SentryPiiRule>;
  applications: Record<string, string[]>;
}

export interface SentryScrubbingRuleSpec {
  source: string;
  type: SentryPiiRuleType;
  method: SentryPiiRedactionMethod;
  pattern?: string;
  text?: string;
  reason: string;
}

export interface SentryScrubbingProjectSettings {
  dataScrubber: true;
  dataScrubberDefaults: true;
  scrubIPAddresses: true;
  relayPiiConfig: string;
}

const DEFAULT_STRING_SOURCES = [
  '$message',
  '$error.value',
  'exception.values.*.value',
  'logentry.formatted',
  'extra.**',
  'contexts.squire.context.**',
  'contexts.squire.diagnostic.**',
  '$span.description',
  '$span.data.**',
  '$log.body',
] as const;

const DEFAULT_PII_RULES: Array<Pick<SentryScrubbingRuleSpec, 'type' | 'method' | 'reason'>> = [
  { type: 'email', method: 'mask', reason: 'email addresses' },
  { type: 'ip', method: 'remove', reason: 'IP addresses' },
  { type: 'creditcard', method: 'mask', reason: 'credit card numbers' },
  { type: 'pemkey', method: 'remove', reason: 'PEM private keys' },
  { type: 'url_auth', method: 'remove', reason: 'credentials embedded in URLs' },
  { type: 'us_ssn', method: 'remove', reason: 'US social security numbers' },
  { type: 'password', method: 'remove', reason: 'password, auth, token, and credential strings' },
  { type: 'userpath', method: 'mask', reason: 'local usernames in file paths' },
] as const;

const FIELD_REMOVE_SOURCES = [
  '$http.headers.authorization',
  '$http.headers.proxy-authorization',
  '$http.headers.cookie',
  '$http.headers.set-cookie',
  '$http.cookies',
  '$http.query_string',
  '$http.data',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.headers.set-cookie',
  'request.cookies',
  'request.query_string',
  'request.data',
  '$user.email',
  '$user.ip_address',
  '$user.name',
  '$user.username',
  '$user.geo.**',
  'extra.email',
  'extra.emailAddress',
  'extra.user_email',
  'extra.name',
  'extra.firstName',
  'extra.lastName',
  'extra.fullName',
  'extra.displayName',
  'extra.phone',
  'extra.phoneNumber',
  'extra.address',
  'extra.mailingAddress',
  'extra.rawPrompt',
  'extra.fullAnswer',
  'extra.modelOutput',
  'extra.providerPayload',
  'extra.providerRequest',
  'extra.providerResponse',
  'extra.retrievedPassages',
  'extra.retrieved_passages',
  'extra.sourceDocument',
  'extra.transcript',
  'extra.request.body',
  'extra.response.body',
  'contexts.squire.context.emailAddress',
  'contexts.squire.context.user_email',
  'contexts.squire.context.name',
  'contexts.squire.context.customerName',
  'contexts.squire.context.phoneNumber',
  'contexts.squire.context.address',
  'contexts.squire.context.rawPrompt',
  'contexts.squire.context.fullAnswer',
  'contexts.squire.context.modelOutput',
  'contexts.squire.context.providerPayload',
  'contexts.squire.context.providerRequest',
  'contexts.squire.context.providerResponse',
  'contexts.squire.context.retrievedPassages',
  'contexts.squire.context.retrieved_passages',
  'contexts.squire.context.sourceDocument',
  'contexts.squire.context.transcript',
  "$span.data.'gen_ai.prompt'",
  "$span.data.'gen_ai.completion'",
  '$span.data.rawPrompt',
  '$span.data.fullAnswer',
  '$span.data.modelOutput',
  '$span.data.providerPayload',
  '$span.data.providerRequest',
  '$span.data.providerResponse',
  '$span.data.retrievedPassages',
  '$span.data.retrieved_passages',
  '$span.data.sourceDocument',
  '$span.data.transcript',
  '$span.data.emailAddress',
  '$span.data.user_email',
  '$span.data.customerName',
  '$span.data.phoneNumber',
  '$span.data.address',
  '$span.data.request.body',
  '$span.data.response.body',
  "$log.attributes.'emailAddress'.value",
  "$log.attributes.'user_email'.value",
  "$log.attributes.'name'.value",
  "$log.attributes.'customerName'.value",
  "$log.attributes.'phoneNumber'.value",
  "$log.attributes.'address'.value",
  "$log.attributes.'rawPrompt'.value",
  "$log.attributes.'fullAnswer'.value",
  "$log.attributes.'modelOutput'.value",
  "$log.attributes.'providerPayload'.value",
  "$log.attributes.'providerRequest'.value",
  "$log.attributes.'providerResponse'.value",
  "$log.attributes.'retrievedPassages'.value",
  "$log.attributes.'retrieved_passages'.value",
  "$log.attributes.'sourceDocument'.value",
  "$log.attributes.'transcript'.value",
  "$log.attributes.'request_body'.value",
  "$log.attributes.'response_body'.value",
] as const;

const CUSTOM_PATTERN_RULES: Array<Omit<SentryScrubbingRuleSpec, 'source'>> = [
  {
    type: 'pattern',
    method: 'replace',
    text: '[Filtered]',
    pattern: '(?i)Bearer\\s+[A-Za-z0-9._~+/=-]{8,}',
    reason: 'bearer tokens in strings',
  },
  {
    type: 'pattern',
    method: 'replace',
    text: '[Filtered]',
    pattern: '(?i)\\b(?:sk|rk|pk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\\b',
    reason: 'common API token prefixes in strings',
  },
  {
    type: 'pattern',
    method: 'replace',
    text: '[Filtered]',
    pattern: '(?i)(access_token|authorization|cookie|password|secret|session|token)=[^&\\s]+',
    reason: 'sensitive URL query parameters in strings',
  },
  {
    type: 'pattern',
    method: 'replace',
    text: '[Filtered]',
    pattern: '\\+?[0-9][0-9 .()/-]{8,}[0-9]',
    reason: 'phone-number-shaped strings',
  },
] as const;

function ruleForSource(
  source: string,
  rule: Pick<SentryScrubbingRuleSpec, 'type' | 'method' | 'pattern' | 'text' | 'reason'>,
): SentryScrubbingRuleSpec {
  return { source, ...rule };
}

export function buildSentryScrubbingRuleSpecs(): SentryScrubbingRuleSpec[] {
  const specs: SentryScrubbingRuleSpec[] = [];

  for (const source of DEFAULT_STRING_SOURCES) {
    for (const rule of DEFAULT_PII_RULES) {
      specs.push(ruleForSource(source, rule));
    }
    for (const rule of CUSTOM_PATTERN_RULES) {
      specs.push(ruleForSource(source, rule));
    }
  }

  for (const source of FIELD_REMOVE_SOURCES) {
    specs.push(
      ruleForSource(source, {
        type: 'anything',
        method: 'remove',
        reason: 'field is never safe for Sentry storage',
      }),
    );
  }

  return specs;
}

export function buildSentryRelayPiiConfig(): SentryRelayPiiConfig {
  const rules: Record<string, SentryPiiRule> = {};
  const applications: Record<string, string[]> = {};

  buildSentryScrubbingRuleSpecs().forEach((spec, index) => {
    const ruleId = String(index);
    rules[ruleId] = {
      type: spec.type,
      redaction: {
        method: spec.method,
        ...(spec.text ? { text: spec.text } : {}),
      },
      ...(spec.pattern ? { pattern: spec.pattern } : {}),
    };
    applications[spec.source] = [...(applications[spec.source] ?? []), ruleId];
  });

  return { rules, applications };
}

export function buildSentryScrubbingProjectSettings(): SentryScrubbingProjectSettings {
  return {
    dataScrubber: true,
    dataScrubberDefaults: true,
    scrubIPAddresses: true,
    relayPiiConfig: JSON.stringify(buildSentryRelayPiiConfig()),
  };
}
