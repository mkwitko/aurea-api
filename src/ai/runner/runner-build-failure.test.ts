import { describe, expect, it, vi } from 'vitest';
import { harness, RUN } from './runner.harness.js';
import { executeAgentRun } from './runner.js';
import { AGENT_REGISTRY } from '../agents/registry.js';

describe('executeAgentRun — agent construction failures', () => {
  // Igual ao teste de budget: em vez de mutar um agente real do registro,
  // registramos um clone dele sob uma taskType nova com buildTools quebrado,
  // e removemos a chave ao final. Nada do estado do módulo usado por outros
  // testes é tocado.
  it('fails the run and tells the policy to refund when buildTools throws', async () => {
    const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
    const throwingTaskType = `summarize-business-context-throwing-buildtools-test-${Math.random()}`;
    AGENT_REGISTRY[throwingTaskType] = {
      ...baseAgent,
      taskType: throwingTaskType,
      buildTools() {
        // Mesma mensagem que SearchProviderError lança quando TAVILY_API_KEY
        // some depois que o run já foi enfileirado e cobrado.
        throw new Error('search provider is not configured');
      },
    };

    try {
      const onRunFailed = vi.fn().mockResolvedValue(undefined);
      const { deps, repo, provider } = harness([]);
      deps.policy = { ...deps.policy, onRunFailed };
      repo.findById.mockResolvedValue({ ...RUN, taskType: throwingTaskType });

      await executeAgentRun(deps, 'run-1');

      // O run nunca chega a chamar o provider: buildTools quebra antes disso.
      expect(provider.requests).toHaveLength(0);
      expect(repo.markFailed).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ error: 'search provider is not configured' }),
      );
      expect(onRunFailed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }), 'run-1');
    } finally {
      delete AGENT_REGISTRY[throwingTaskType];
    }
  });
});
