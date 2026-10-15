import { NotFoundError, RunAlreadyFinishedError } from '../../../../lib/errors.js';
import type { TenantContext } from '../../../../lib/tenant.js';
import type { AgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';

export type CancelAgentRunDeps = {
  repo: AgentRunRepository;
  removeJob(agentRunId: string): Promise<void>;
  refund(agentRunId: string): Promise<void>;
  notify(workspaceId: string, agentRunId: string): Promise<void>;
};

/**
 * Cancela um run em voo.
 *
 * A ordem importa: primeiro o banco (fonte de verdade — é o que o runner relê
 * entre chamadas de modelo e o que a tela lê), depois a fila, depois o
 * estorno. Tirar da fila antes de marcar deixaria uma janela em que o job some
 * e a linha continua RUNNING, que é exatamente o run-fantasma que o reaper
 * existe para limpar.
 */
export function cancelAgentRunService(deps: CancelAgentRunDeps) {
  return async ({ tenant, id }: { tenant: TenantContext; id: string }) => {
    // Run de outro workspace é 404, não 403: existência é informação.
    const run = await deps.repo.findInWorkspace(id, tenant.workspaceId);
    if (!run) throw new NotFoundError('Agent run not found');

    const cancelled = await deps.repo.cancel(id, tenant.workspaceId);
    // Corrida perdida para o runner: o run terminou entre a leitura e o
    // update. O resultado dele vale, e o cliente precisa saber que não houve
    // cancelamento — devolver 200 aqui faria a tela apagar um resultado pago.
    if (!cancelled) throw new RunAlreadyFinishedError({ status: run.status });

    await deps.removeJob(id);
    // Run cancelado não é run entregue. Idempotente pela unique de
    // (agentRunId, kind), e no-op quando nem chegou a haver débito.
    await deps.refund(id);
    // Outras abas do mesmo workspace acompanham o run por SSE. Um evento
    // perdido custa, no pior caso, o intervalo do poll — nunca pode derrubar
    // um cancelamento que já foi efetivado no banco.
    await deps.notify(tenant.workspaceId, id).catch(() => {});

    const updated = await deps.repo.findInWorkspace(id, tenant.workspaceId);
    return updated ?? run;
  };
}
