import { describe, expect, it } from 'vitest';
import type { AgentRun } from '@prisma/client';
import { presentAgentRun } from './agent-runs.presenter.js';

const run = {
  id: 'run-1',
  taskType: 'propose-goal',
  agentType: 'growth-strategist',
  status: 'COMPLETED',
  input: {},
  output: {},
  error: null,
  model: 'deepseek-v4-flash',
  createdAt: new Date('2026-07-31T12:00:00Z'),
  completedAt: new Date('2026-07-31T12:00:09Z'),
} as unknown as AgentRun;

describe('presentAgentRun', () => {
  it('carries a null traceUrl when tracing is not configured', async () => {
    await expect(presentAgentRun(run)).resolves.toMatchObject({ id: 'run-1', traceUrl: null });
  });
});
