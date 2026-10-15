import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness, RUN, finalAnswer, submitAnswer } from './runner.harness.js';
import { AGENT_REGISTRY, type AgentBudget } from '../agents/registry.js';
import type { AiCompletion, AiCompletionRequest } from '../providers/provider.js';

beforeEach(() => vi.clearAllMocks());

/**
 * Uma chamada cortada pelo teto de saída: o provider devolve o argumento pela
 * metade (`__unparseableArguments`) com `finishReason: 'length'`. É a forma
 * exata que derrubou o preenchimento por IA da aba de negócios — o modelo
 * reenviava o mesmo tamanho, era cortado no mesmo lugar, e o run morria com a
 * mensagem do guardrail depois de gastar o orçamento inteiro.
 */
const truncatedSubmit = (id = 'call-cut'): AiCompletion => ({
  text: null,
  toolCalls: [{ id, name: 'submit_answer', args: { __unparseableArguments: '{"summary": ' } }],
  usage: { inputTokens: 100, outputTokens: 2048, cachedInputTokens: 0 },
  finishReason: 'length',
});

const truncatedText = (): AiCompletion => ({
  text: '{"summary": "Acme sells',
  toolCalls: [],
  usage: { inputTokens: 100, outputTokens: 2048, cachedInputTokens: 0 },
  finishReason: 'length',
});

const ceilings = (requests: AiCompletionRequest[]) => requests.map((request) => request.maxTokens);

// Mesmo padrão do runner-budget.test.ts: um agente temporário sob uma taskType
// nova, em vez de mutar o agente real que outros testes leem.
async function runWithBudget(budget: AgentBudget, script: AiCompletion[]) {
  const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
  const taskType = `summarize-business-context-truncation-test-${Math.random()}`;
  AGENT_REGISTRY[taskType] = { ...baseAgent, taskType, budget };

  try {
    const { deps, repo, provider } = harness(script);
    repo.findById.mockResolvedValue({ ...RUN, taskType });
    await executeAgentRun(deps, 'run-1');
    return { repo, provider };
  } finally {
    delete AGENT_REGISTRY[taskType];
  }
}

describe('executeAgentRun — output cut off by the token ceiling', () => {
  it('gives the next call more room after a call was cut off', async () => {
    // Sem isto o laço não converge: o teto é constante, então a resposta é
    // cortada no mesmo ponto a cada tentativa até o orçamento acabar.
    const { deps, repo, provider } = harness([truncatedSubmit(), submitAnswer()]);

    await executeAgentRun(deps, RUN.id);

    expect(ceilings(provider.requests)).toEqual([2048, 4096]);
    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });

  it('grows the ceiling for a truncated plain-text answer too', async () => {
    // O corte não é privilégio do caminho de tool: um modelo que responde em
    // texto também para no meio do JSON, e o guardrail reprova por parse.
    const { deps, provider } = harness([truncatedText(), finalAnswer()]);

    await executeAgentRun(deps, RUN.id);

    expect(ceilings(provider.requests)).toEqual([2048, 4096]);
  });

  it('stops growing at the ceiling cap', async () => {
    // Dobrar sem teto pediria ao provider um max_tokens que ele recusa, e uma
    // recusa de request custa o run inteiro em vez de uma tentativa.
    const { provider } = await runWithBudget(
      { maxToolIterations: 6, maxModelCalls: 6, maxOutputTokens: 8192 },
      // Sete, não seis: o único crescimento possível (8192 → 16384) compra uma
      // iteração a mais — ver o crédito por truncagem abaixo.
      Array.from({ length: 7 }, (_, i) => truncatedSubmit(`call-cut-${i}`)),
    );

    expect(ceilings(provider.requests)).toEqual([8192, 16_384, 16_384, 16_384, 16_384, 16_384, 16_384]);
  });

  it('does not spend the agent budget on our own ceiling', async () => {
    // Run ebf8e706: o propose-icp tinha 3 iterações, a primeira foi a tool de
    // contexto e as duas seguintes saíram cortadas — "tool iteration cap
    // reached (3)", FAILED, crédito estornado, fundador sem ICP. Crescer o teto
    // e não dar iteração para usar o espaço novo é a mesma falha com outro
    // nome, então cada crescimento compra uma iteração e uma chamada de modelo.
    const { repo, provider } = await runWithBudget(
      { maxToolIterations: 2, maxModelCalls: 2, maxOutputTokens: 2048 },
      [truncatedSubmit('cut-1'), truncatedSubmit('cut-2'), submitAnswer()],
    );

    expect(ceilings(provider.requests)).toEqual([2048, 4096, 8192]);
    expect(repo.markCompleted).toHaveBeenCalledOnce();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('stops granting after three growths, so a stuck model cannot run forever', async () => {
    // O crédito existe para o teto que NÓS escolhemos apertado, não para um
    // modelo que insiste em respostas gigantes: três é o que o dobro precisa
    // para ir de 2048 a 16384, e depois disso o orçamento manda.
    const { repo, provider } = await runWithBudget(
      { maxToolIterations: 2, maxModelCalls: 2, maxOutputTokens: 2048 },
      Array.from({ length: 8 }, (_, i) => truncatedSubmit(`cut-${i}`)),
    );

    // 2 do orçamento declarado + 3 concedidas.
    expect(provider.requests).toHaveLength(5);
    expect(ceilings(provider.requests)).toEqual([2048, 4096, 8192, 16_384, 16_384]);
    expect(repo.markFailed).toHaveBeenCalledOnce();
  });

  it('leaves the ceiling alone when the model stopped on its own', async () => {
    // Argumento inválido com finishReason 'tool_calls' é erro de conteúdo, não
    // de espaço. Crescer aqui pagaria mais saída por um erro que mais saída não
    // corrige.
    const { deps, provider } = harness([submitAnswer({ summary: '' }, 'call-bad'), submitAnswer()]);

    await executeAgentRun(deps, RUN.id);

    expect(ceilings(provider.requests)).toEqual([2048, 2048]);
  });
});

describe('executeAgentRun — per-agent run timeout', () => {
  /** Provider que só termina quando o run é abortado. */
  const hangingProvider = () => ({
    name: 'hanging',
    complete: (request: AiCompletionRequest) =>
      new Promise<AiCompletion>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
      }),
  });

  it('honours a maxRunMs above the global timeout', async () => {
    // Um agente que faz oito buscas e dezoito chamadas de modelo não cabe nos
    // 180s globais: ele morria em "This operation was aborted" com o crédito
    // já gasto. O teto do run passa a ser declarado pelo agente, como os
    // outros três tetos.
    vi.useFakeTimers();
    const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
    const taskType = 'summarize-business-context-timeout-test';
    AGENT_REGISTRY[taskType] = { ...baseAgent, taskType, budget: { maxRunMs: 600_000 } };

    try {
      const { deps, repo } = harness([], { createProvider: () => hangingProvider() });
      repo.findById.mockResolvedValue({ ...RUN, taskType });

      const run = executeAgentRun(deps, 'run-1');

      await vi.advanceTimersByTimeAsync(180_001);
      expect(repo.markFailed).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(420_001);
      await run;

      expect(repo.markFailed).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ error: 'This operation was aborted' }),
      );
    } finally {
      delete AGENT_REGISTRY[taskType];
      vi.useRealTimers();
    }
  });

  it('falls back to the global timeout when the agent declares none', async () => {
    vi.useFakeTimers();

    try {
      const { deps, repo } = harness([], { createProvider: () => hangingProvider() });

      const run = executeAgentRun(deps, RUN.id);

      await vi.advanceTimersByTimeAsync(180_001);
      await run;

      expect(repo.markFailed).toHaveBeenCalledWith(
        RUN.id,
        expect.objectContaining({ error: 'This operation was aborted' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
