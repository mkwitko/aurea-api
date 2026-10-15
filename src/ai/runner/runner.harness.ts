import { vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { RunnerDeps } from './runner.js';
import { createFakeProvider } from '../providers/fake.js';
import type { AiCompletion } from '../providers/provider.js';
import { defaultPolicy } from '../policy.js';

export const RUN = {
  id: 'run-1',
  workspaceId: 'ws-1',
  taskType: 'summarize-business-context',
  agentType: 'context-analyst',
  tier: 'TIER1',
  status: 'PENDING',
  modelCalls: 0,
  input: { businessId: '3f1e8f6e-1f1a-4f0e-9b0e-0f6d3b7a1c22' },
  requestedBy: 'u1',
};

export function harness(script: AiCompletion[], overrides: Partial<RunnerDeps> = {}) {
  const provider = createFakeProvider(script);
  const repo = {
    findById: vi.fn().mockResolvedValue(RUN),
    markRunning: vi.fn().mockResolvedValue({ count: 1 }),
    touchHeartbeat: vi.fn().mockResolvedValue({}),
    markCompleted: vi.fn().mockResolvedValue({}),
    markFailed: vi.fn().mockResolvedValue({}),
    recordToolCall: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    membership: { findFirst: vi.fn().mockResolvedValue({ organizationId: 'o1', role: 'OWNER' }) },
    business: { findFirst: vi.fn().mockResolvedValue({ id: RUN.input.businessId, name: 'Acme' }) },
    businessContext: {
      findUnique: vi.fn().mockResolvedValue({ currentVersion: { data: { companyProfile: { mission: 'm' } } } }),
    },
  };
  const deps: RunnerDeps = {
    prisma: prisma as unknown as PrismaClient,
    repo: repo as unknown as RunnerDeps['repo'],
    policy: { ...defaultPolicy, resolveProviderCredentials: async () => ({ apiKey: 'k', source: 'PLATFORM' }) },
    createProvider: () => provider,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  return { deps, repo, provider, prisma };
}

export const finalAnswer = (): AiCompletion => ({
  text: JSON.stringify({ summary: 'Acme sells X', risks: ['a', 'b', 'c'], confidence: 'MEDIUM' }),
  toolCalls: [],
  usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 },
  finishReason: 'stop',
});

export const submitAnswer = (
  args: unknown = { summary: 'Acme sells X', risks: ['a', 'b', 'c'], confidence: 'MEDIUM' },
  id = 'call-submit-1',
): AiCompletion => ({
  text: null,
  toolCalls: [{ id, name: 'submit_answer', args }],
  usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 },
  finishReason: 'tool_calls',
});
