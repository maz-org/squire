import { createHash } from 'node:crypto';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  LEGACY_AGENT_SYSTEM_PROMPT,
  LEGACY_AGENT_TOOLS,
} from '../src/agent.ts';
import type { EvalMatrixGuardrails, EvalProviderConfig, EvalToolSurface } from './cli.ts';
import {
  OPENAI_TOOL_SCHEMA_VERSION,
  getOpenAiToolSchemaHash,
  openAiToolsForSurface,
} from './openai-schema.ts';

export const ANTHROPIC_TOOL_SCHEMA_VERSION = 'squire-anthropic-tools-v1' as const;

export type EvalModelSettings = Record<string, string | number | boolean | null | undefined>;

export interface EvalRunCompatibilityMetadata {
  promptVersion: string;
  promptHash: string;
  toolSurface: EvalToolSurface;
  toolSchemaVersion: string;
  toolSchemaHash: string;
}

export interface EvalMatrixRunSettings {
  retryCount: number;
  maxEstimatedCostUsd: number;
  providerConcurrency: Record<'anthropic' | 'openai', number>;
}

export function evalPromptVersionFor(toolSurface: EvalToolSurface): string {
  return toolSurface === 'legacy' ? 'legacy-agent-v1' : 'redesigned-agent-v1';
}

export function evalPromptHashFor(toolSurface: EvalToolSurface): string {
  const prompt = toolSurface === 'legacy' ? LEGACY_AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`;
}

export function evalToolSchemaVersionFor(config: EvalProviderConfig): string {
  return config.provider === 'openai' ? OPENAI_TOOL_SCHEMA_VERSION : ANTHROPIC_TOOL_SCHEMA_VERSION;
}

export function evalToolSchemaHashFor(
  config: EvalProviderConfig,
  toolSurface: EvalToolSurface,
): string {
  if (config.provider === 'openai')
    return getOpenAiToolSchemaHash(openAiToolsForSurface(toolSurface));
  const tools = toolSurface === 'legacy' ? LEGACY_AGENT_TOOLS : AGENT_TOOLS;
  return `sha256:${createHash('sha256').update(JSON.stringify(tools)).digest('hex')}`;
}

export function evalModelSettingsFor(config: EvalProviderConfig): EvalModelSettings {
  return {
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    toolLoopLimit: config.toolLoopLimit,
    broadSearchSynthesisThreshold: config.broadSearchSynthesisThreshold,
  };
}

export function evalRunCompatibilityFor(
  config: EvalProviderConfig,
  toolSurface: EvalToolSurface,
): EvalRunCompatibilityMetadata {
  return {
    promptVersion: evalPromptVersionFor(toolSurface),
    promptHash: evalPromptHashFor(toolSurface),
    toolSurface,
    toolSchemaVersion: evalToolSchemaVersionFor(config),
    toolSchemaHash: evalToolSchemaHashFor(config, toolSurface),
  };
}

export function evalMatrixRunSettingsFor(guardrails: EvalMatrixGuardrails): EvalMatrixRunSettings {
  return {
    retryCount: guardrails.retryCount,
    maxEstimatedCostUsd: guardrails.maxEstimatedCostUsd,
    providerConcurrency: guardrails.providerConcurrency,
  };
}
