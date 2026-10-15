import { describe, expect, it } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness, submitAnswer } from './runner.harness.js';
import type { AiCompletion } from '../providers/provider.js';

// Regression coverage for the Critical review finding on Tasks 1-3: a
// schema-valid submit_answer whose CONTENT agent.verifyOutput rejects (the
// interpret-outcome invention guard, see src/ai/agents/interpret-outcome.ts)
// must still get a role:'tool' reply for its call id before the loop retries.
// Without that reply, the next provider.complete() carries an assistant
// message with an unanswered tool_calls entry followed by a user message —
// every OpenAI-compatible backend 400s on that shape (openai-compatible.ts
// maps messages 1:1 onto the wire format). The fake provider does no
// structural validation, so only asserting on the recorded messages catches it.

const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

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
  workspaceId: 'ws-1',
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

function draft(evidence: string[]) {
  return {
    reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
    drivers: ['The founder-led angle drove replies.'],
    caveats: [],
    learning: {
      title: 'Funding-round personalization lifts reply rate',
      statement: 'Keep using the funding-round angle.',
      evidence,
      confidence: 'MEDIUM',
    },
  };
}

describe('executeAgentRun — submit_answer rejected by verifyOutput', () => {
  it('replies to the rejected submit tool call before retrying, and completes once corrected', async () => {
    const invented = submitAnswer(draft(['42 replies recorded on 2026-07-30']), 'call-outcome-1');
    const sourced = submitAnswer(draft(['18 replies recorded on 2026-07-30']), 'call-outcome-2');

    const { deps, repo, prisma, provider } = harness([toolCall(), invented, sourced]);
    (prisma as unknown as { experiment: { findFirst: (...a: unknown[]) => unknown } }).experiment = {
      findFirst: async () => EXPERIMENT_ROW,
    };
    repo.findById.mockResolvedValue(RUN);
    repo.markRunning.mockResolvedValue({ ...RUN, status: 'RUNNING' });

    await executeAgentRun(deps, 'run-1');

    // requests[0] = the get_experiment_result round; requests[1] = the first
    // submit_answer (schema-valid, invented citation) gets fed back to the
    // model as the response to requests[2]. The Critical fix is that the
    // messages sent for requests[2] already contain a role:'tool' reply for
    // call-outcome-1, pushed the moment the submit was accepted structurally
    // — before verifyOutput ever ran.
    expect(provider.requests).toHaveLength(3);
    const thirdCallMessages = provider.requests[2]!.messages;
    const toolReply = thirdCallMessages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'call-outcome-1',
    );
    expect(toolReply).toBeDefined();

    expect(repo.markCompleted).toHaveBeenCalledOnce();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });
});
