import { describe, expect, it } from 'vitest';
import { executeAgentRun } from '../runner/runner.js';
import { harness } from '../runner/runner.harness.js';
import type { AiCompletion } from '../providers/provider.js';

// This is the integration-level evidence for two of the final review's fixes:
//
// 1. The prose verdict guard (superRefine on `reading`/`drivers`/`caveats`/
//    `learning.title`/`learning.statement`) lands inside the runner's
//    existing guardrail retry loop, so a first offence self-corrects rather
//    than failing the run outright.
// 2. The invention guard (verifyEvidence, spec §5/§6) uses the SAME retry
//    mechanism: a fabricated citation gets fed back as guardrail feedback,
//    and a model that never corrects it exhausts the budget and fails,
//    never completing with an invented number.

const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = 'ws-1';

const EXPERIMENT_ROW = {
  id: EXPERIMENT_ID,
  name: 'LinkedIn DM test',
  objective: 'book discovery calls',
  channel: 'linkedin',
  audience: 'seed-stage founders',
  metric: 'replies',
  baselineValue: 4,
  targetValue: 25,
  successCriteria: 'replies >= 25 over 30 days',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-31T00:00:00Z'),
  status: 'COMPLETED',
  hypothesis: {
    statement: 'a personal DM referencing the funding round beats cold email',
    expectedOutcome: 'reply rate above 20%',
    targetMetric: 'replies',
  },
  strategy: { name: 'founder-led outbound', goals: [] },
  outcomes: [
    { metric: 'replies', value: 18, unit: 'replies', observedAt: new Date('2026-07-30T00:00:00Z'), source: 'USER' },
  ],
};

const RUN = {
  id: 'run-1',
  workspaceId: WORKSPACE_ID,
  taskType: 'interpret-outcome',
  agentType: 'outcome-analyst',
  tier: 'TIER2',
  status: 'PENDING',
  modelCalls: 0,
  input: { experimentId: EXPERIMENT_ID },
  requestedBy: 'u1',
};

const toolCall = (): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 'call_1', name: 'get_experiment_result', args: {} }],
  usage: { inputTokens: 40, outputTokens: 10, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

const VALID_LEARNING = {
  title: 'Funding-round personalization lifts reply rate',
  evidence: ['18 replies recorded on 2026-07-30', 'baseline was 4, target was 25'],
  confidence: 'MEDIUM' as const,
};

function completion(output: unknown): AiCompletion {
  return {
    text: JSON.stringify(output),
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 0 },
    finishReason: 'stop',
  };
}

describe('interpret-outcome — guardrails run inside the retry loop', () => {
  it('a first prose-verdict offence self-corrects instead of failing the run', async () => {
    const ruled = completion({
      reading: 'This experiment was a success — 18 replies against a target of 25.',
      drivers: ['The founder-led angle drove replies.'],
      caveats: [],
      learning: { ...VALID_LEARNING, statement: 'Keep using the funding-round angle.' },
    });
    const clean = completion({
      reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
      drivers: ['The founder-led angle drove replies.'],
      caveats: [],
      learning: { ...VALID_LEARNING, statement: 'Keep using the funding-round angle.' },
    });

    const { deps, repo, prisma, provider } = harness([toolCall(), ruled, clean]);
    (prisma as unknown as { experiment: { findFirst: (...a: unknown[]) => unknown } }).experiment = {
      findFirst: async () => EXPERIMENT_ROW,
    };
    repo.findById.mockResolvedValue(RUN);
    repo.markRunning.mockResolvedValue({ ...RUN, status: 'RUNNING' });

    await executeAgentRun(deps, 'run-1');

    // Evidence the guard rejected the first attempt rather than never firing:
    // the fake provider was called a third time with the rejection fed back
    // as a user message, and the run still completes.
    expect(provider.requests).toHaveLength(3);
    const feedback = provider.requests[2]!.messages.at(-1)!;
    expect('content' in feedback ? feedback.content : '').toMatch(/do not rule on the experiment/i);
    expect(repo.markCompleted).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('a fabricated evidence citation self-corrects instead of failing the run', async () => {
    const invented = completion({
      reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
      drivers: ['The founder-led angle drove replies.'],
      caveats: [],
      learning: { ...VALID_LEARNING, evidence: ['42 replies recorded on 2026-07-30'], statement: 'Keep going.' },
    });
    const sourced = completion({
      reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
      drivers: ['The founder-led angle drove replies.'],
      caveats: [],
      learning: { ...VALID_LEARNING, statement: 'Keep going.' },
    });

    const { deps, repo, prisma, provider } = harness([toolCall(), invented, sourced]);
    (prisma as unknown as { experiment: { findFirst: (...a: unknown[]) => unknown } }).experiment = {
      findFirst: async () => EXPERIMENT_ROW,
    };
    repo.findById.mockResolvedValue(RUN);
    repo.markRunning.mockResolvedValue({ ...RUN, status: 'RUNNING' });

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(3);
    const feedback = provider.requests[2]!.messages.at(-1)!;
    expect('content' in feedback ? feedback.content : '').toMatch(/does not appear anywhere in the/i);
    expect(repo.markCompleted).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('a run that never corrects a fabricated citation fails, and never completes with the invented number', async () => {
    const invented = completion({
      reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
      drivers: ['The founder-led angle drove replies.'],
      caveats: [],
      learning: { ...VALID_LEARNING, evidence: ['999 replies recorded on 2026-07-30'], statement: 'Keep going.' },
    });

    const { deps, repo, prisma } = harness([toolCall(), invented, invented, invented]);
    (prisma as unknown as { experiment: { findFirst: (...a: unknown[]) => unknown } }).experiment = {
      findFirst: async () => EXPERIMENT_ROW,
    };
    repo.findById.mockResolvedValue(RUN);
    repo.markRunning.mockResolvedValue({ ...RUN, status: 'RUNNING' });

    await executeAgentRun(deps, 'run-1');

    expect(repo.markCompleted).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalled();
    expect(repo.markFailed.mock.calls[0]![1].error).toMatch(/does not appear anywhere in the/i);
  });
});
