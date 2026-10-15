import { describe, expect, it, vi } from 'vitest';
import { executeAgentRun } from './runner.js';
import { finalAnswer, harness, RUN } from './runner.harness.js';

// O BullMQ não interrompe um job que já está executando, então cancelar é
// cooperativo: o endpoint marca CANCELLED e estorna, e o runner para de
// gastar modelo assim que percebe. O que estes testes trancam é o "assim que
// percebe" — sem eles, um cancelamento vira só um botão que não faz nada, e
// pior: o run termina depois e sobrescreve o cancelamento com um resultado.
describe('cancelling a run in flight', () => {
  it('stops before calling the model when the row was already cancelled', async () => {
    const { deps, repo, provider } = harness([finalAnswer()]);
    repo.findById.mockResolvedValue({ ...RUN, status: 'CANCELLED' });

    await executeAgentRun(deps, RUN.id);

    expect(provider.requests).toHaveLength(0);
    expect(repo.markCompleted).not.toHaveBeenCalled();
    // Nada de FAILED: quem fechou a linha foi o cancelamento, e sobrescrever
    // trocaria o motivo real por um erro que não houve.
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('does not start a run that was cancelled while it waited in the queue', async () => {
    const { deps, repo, provider } = harness([finalAnswer()]);
    // markRunning é condicional a PENDING: count 0 significa que alguém já
    // fechou a linha entre a leitura e o início.
    repo.markRunning.mockResolvedValue({ count: 0 });

    await executeAgentRun(deps, RUN.id);

    expect(provider.requests).toHaveLength(0);
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });

  it('stops between model calls when the founder cancels mid-run', async () => {
    const { deps, repo, provider } = harness([finalAnswer(), finalAnswer()]);
    // 1ª leitura (entrada do runner) e 2ª (1ª iteração do laço) vivas; da 3ª
    // em diante, cancelado — o run não pode encostar no modelo de novo.
    repo.findById = vi
      .fn()
      .mockResolvedValueOnce(RUN)
      .mockResolvedValueOnce(RUN)
      .mockResolvedValue({ ...RUN, status: 'CANCELLED' });

    await executeAgentRun(deps, RUN.id);

    expect(provider.requests.length).toBeLessThanOrEqual(1);
    expect(repo.markFailed).not.toHaveBeenCalled();
  });
});
