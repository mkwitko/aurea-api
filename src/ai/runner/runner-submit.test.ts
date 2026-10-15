import { describe, expect, it } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness, RUN, finalAnswer, submitAnswer } from './runner.harness.js';

describe('executeAgentRun — submit_answer', () => {
  it('offers submit_answer to the model alongside the agent tools', async () => {
    const { deps, provider } = harness([submitAnswer()]);
    await executeAgentRun(deps, RUN.id);

    const names = provider.requests[0]!.tools!.map((tool) => tool.name);
    expect(names).toContain('submit_answer');
    expect(names.length).toBeGreaterThan(1);
  });

  it('completes the run from the tool arguments, without a JSON parse', async () => {
    const { deps, repo } = harness([submitAnswer()]);
    await executeAgentRun(deps, RUN.id);

    expect(repo.markCompleted).toHaveBeenCalledOnce();
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.markCompleted.mock.calls[0]![1].output).toMatchObject({ summary: 'Acme sells X' });
  });

  it('sends bad arguments back as a tool result and accepts the correction in the same attempt', async () => {
    const { deps, repo, provider } = harness([
      submitAnswer({ summary: '', risks: [], confidence: 'NOPE' }, 'call-bad'),
      submitAnswer(),
    ]);
    await executeAgentRun(deps, RUN.id);

    const secondCallMessages = provider.requests[1]!.messages;
    const toolReply = secondCallMessages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'call-bad',
    );
    expect(toolReply).toBeDefined();
    expect(JSON.stringify(toolReply)).toContain('submit_answer');
    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });

  it('does not persist a rejected submit as a tool call result', async () => {
    // Um submit reprovado não é trabalho feito: gravá-lo em AgentRunToolCall
    // enche o histórico do run de tentativas que não produziram nada.
    const { deps, repo } = harness([
      submitAnswer({ summary: '' }, 'call-bad'),
      submitAnswer(),
    ]);
    await executeAgentRun(deps, RUN.id);

    const recorded = repo.recordToolCall.mock.calls.map((call) => call[0].name);
    expect(recorded).not.toContain('submit_answer');
  });

  it('still completes a run from plain text, so a model that ignores the tool is not stranded', async () => {
    const { deps, repo } = harness([finalAnswer()]);
    await executeAgentRun(deps, RUN.id);

    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });

  it('turns off json mode while the submit tool is offered', async () => {
    // response_format json_object empurra o modelo a escrever JSON em texto —
    // exatamente o que a tool existe para substituir. Os dois juntos fazem o
    // modelo devolver o objeto como prosa e ignorar submit_answer.
    const { deps, provider } = harness([submitAnswer()]);
    await executeAgentRun(deps, RUN.id);

    expect(provider.requests[0]!.jsonMode).toBe(false);
  });

  it('fails the run when the budget runs out on repeated bad submits', async () => {
    const bad = () => submitAnswer({ summary: '' }, 'call-bad');
    const { deps, repo } = harness([bad(), bad(), bad(), bad(), bad()]);
    await executeAgentRun(deps, RUN.id);

    expect(repo.markFailed).toHaveBeenCalledOnce();
    expect(repo.markFailed.mock.calls[0]![1].error).toContain('submit_answer');
  });
});
