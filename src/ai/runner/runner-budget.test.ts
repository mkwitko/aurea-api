import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, RUN } from './runner.harness.js';
import { executeAgentRun } from './runner.js';
import type { AiCompletion } from '../providers/provider.js';
import { AGENT_REGISTRY, type AgentBudget } from '../agents/registry.js';
import { researchGrowthContextAgent } from '../agents/research-growth-context.js';

// Uma completion que só pede tool: usada em série, ela mantém o laço girando
// até bater no teto de iterações — que é justamente o que este teste mede.
const toolCall = (): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 't1', name: 'get_business_context', args: {} }],
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

beforeEach(() => vi.clearAllMocks());

describe('per-agent run budget', () => {
  it('uses the module defaults when the agent declares no budget', async () => {
    const { deps, repo, provider } = harness(Array.from({ length: 10 }, toolCall));

    await executeAgentRun(deps, 'run-1');

    // MAX_MODEL_CALLS = 3 é o teto padrão e nada no summarize-business-context
    // o altera.
    expect(provider.requests).toHaveLength(3);
    expect(repo.markFailed).toHaveBeenCalledWith('run-1', expect.objectContaining({ modelCalls: 3 }));
  });

  // Em vez de mutar o registro compartilhado (e depender de restaurá-lo
  // certinho no finally), registramos um agente temporário sob uma taskType
  // nova — clone do agente real com um budget — e removemos a chave ao
  // final. Nada do estado do módulo usado por outros testes é tocado.
  async function runWithBudget(budget: AgentBudget) {
    const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
    const budgetTaskType = `summarize-business-context-with-budget-test-${Math.random()}`;
    AGENT_REGISTRY[budgetTaskType] = { ...baseAgent, taskType: budgetTaskType, budget };

    try {
      const { deps, repo, provider } = harness(Array.from({ length: 10 }, toolCall));
      repo.findById.mockResolvedValue({ ...RUN, taskType: budgetTaskType });
      await executeAgentRun(deps, 'run-1');
      return { deps, repo, provider };
    } finally {
      delete AGENT_REGISTRY[budgetTaskType];
    }
  }

  // Os dois testes abaixo usam valores DIFERENTES para maxToolIterations e
  // maxModelCalls (nunca o mesmo número) — cada um só passa se o teto que ele
  // mira for o que realmente parou o laço. Se maxToolIterations ficasse preso
  // no default do módulo (5) e só maxModelCalls estivesse de fato ligado, o
  // teste abaixo (iterações menor que chamadas) pegaria isso: o laço rodaria
  // 5 chamadas em vez de 2, e a mensagem de erro citaria o teto errado.
  it('honours a tool-iteration cap lower than the model-call cap', async () => {
    const { repo, provider } = await runWithBudget({ maxToolIterations: 2, maxModelCalls: 5, maxOutputTokens: 4096 });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.maxTokens).toBe(4096);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: expect.stringContaining('tool iteration cap reached (2)') }),
    );
  });

  // Espelho do teste acima: agora é maxModelCalls quem é o teto mais baixo, e
  // se a resolução de maxModelCalls estivesse quebrada (caindo no default do
  // módulo, 3), o laço só pararia depois de mais chamadas do que as 2
  // declaradas, e a mensagem citaria "budget exhausted" com o número errado.
  it('honours a model-call cap lower than the tool-iteration cap', async () => {
    const { repo, provider } = await runWithBudget({ maxToolIterations: 5, maxModelCalls: 2, maxOutputTokens: 4096 });

    expect(provider.requests).toHaveLength(2);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: expect.stringContaining('model call budget exhausted (2)') }),
    );
  });

  // O orçamento REAL do research-growth-context, lido do próprio agente em vez
  // de copiado: se maxModelCalls voltar a ficar abaixo de maxToolIterations,
  // este teste cai.
  //
  // O que ele prova: com um script que só pede tool, o laço roda as 8
  // iterações declaradas e quem o para é o teto de iterações — as chamadas 5 a
  // 8 são alcançáveis. Com maxModelCalls: 4 o run morria na quarta chamada,
  // depois de já ter pago o provedor de busca, e a mensagem de erro citaria o
  // teto de orçamento em vez do de iterações.
  it('lets the research budget reach its last tool iteration', async () => {
    const budget = researchGrowthContextAgent.budget;
    const { repo, provider } = await runWithBudget(budget!);

    expect(budget?.maxModelCalls).toBe(budget?.maxToolIterations);
    expect(provider.requests).toHaveLength(8);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ error: expect.stringContaining('tool iteration cap reached (8)') }),
    );
  });
});
