import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { proposalUsageRoute } from './proposal-usage.controller.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';

// Só o que o serviço usa do repositório: um `findMany` de estratégias com as
// duas colunas de proveniência.
const buildApp = async (rows: { sourceOptionIndex: number | null; sourceOptionIndexes: number[] }[]) => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', { strategy: { findMany: vi.fn().mockResolvedValue(rows) } } as never);
  app.addHook('preHandler', async (req) => {
    (req as { tenant?: unknown }).tenant = { workspaceId: 'ws-1', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' };
  });
  await app.register(proposalUsageRoute);
  return app;
};

describe('GET /strategies/proposal-usage', () => {
  it('devolve as opções que já sustentam uma estratégia', async () => {
    const app = await buildApp([{ sourceOptionIndex: 0, sourceOptionIndexes: [0, 2] }]);

    const res = await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(res.statusCode).toBe(200);
    // Um plano combinado gasta todas as opções que entraram nele, não só a
    // primeira: é o que impede adotar a 2 sozinha depois de combinar 0+2.
    expect(res.json().usedOptionIndexes.sort()).toEqual([0, 2]);
  });

  it('busca por workspaceId do tenant, não por um valor fixo', async () => {
    // Sem esta asserção a suíte passaria mesmo se o serviço lesse o workspace
    // de outro lugar (ou de lugar nenhum) — nenhum teste aqui olhava o `where`.
    const findMany = vi.fn().mockResolvedValue([]);
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', { strategy: { findMany } } as never);
    app.addHook('preHandler', async (req) => {
      (req as { tenant?: unknown }).tenant = { workspaceId: 'ws-1', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' };
    });
    await app.register(proposalUsageRoute);

    await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', sourceAgentRunId: RUN_ID } }),
    );
  });

  it('não devolve uso de um run que pertence a outro workspace', async () => {
    // Global Constraints do plano: isolamento por workspace mesmo quando o
    // agentRunId é válido em outro tenant. O repositório real filtra por
    // workspaceId no `where`; aqui o fake só devolve linhas quando o `where`
    // bate com o workspace do tenant — um serviço que ignorasse o workspace
    // do request veria as linhas do outro tenant.
    const findMany = vi.fn().mockImplementation(({ where }: { where: { workspaceId: string } }) =>
      where.workspaceId === 'ws-1' ? [{ sourceOptionIndex: 0, sourceOptionIndexes: [0] }] : [],
    );
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', { strategy: { findMany } } as never);
    app.addHook('preHandler', async (req) => {
      (req as { tenant?: unknown }).tenant = { workspaceId: 'ws-outro', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' };
    });
    await app.register(proposalUsageRoute);

    const res = await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ usedOptionIndexes: [] });
  });

  it('devolve lista vazia quando nada foi adotado', async () => {
    const app = await buildApp([]);

    const res = await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ usedOptionIndexes: [] });
  });

  it('recusa um agentRunId que não é uuid', async () => {
    const app = await buildApp([]);

    const res = await app.inject({ method: 'GET', url: '/strategies/proposal-usage?agentRunId=nope' });

    expect(res.statusCode).toBe(400);
  });
});
