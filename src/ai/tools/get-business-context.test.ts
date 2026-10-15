import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createGetBusinessContextTool } from './get-business-context.js';
import type { ToolContext } from './tool.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };

function ctxWith(business: unknown, context: unknown): ToolContext {
  return {
    tenant,
    prisma: {
      business: { findFirst: vi.fn().mockResolvedValue(business) },
      businessContext: { findUnique: vi.fn().mockResolvedValue(context) },
    } as unknown as PrismaClient,
    signal: new AbortController().signal,
  };
}

const ACME = {
  id: 'b-1',
  name: 'Acme',
  description: 'We sell widgets to factories.',
  website: 'https://acme.test',
  industry: 'Manufacturing',
  businessModel: 'B2B',
  revenueModel: 'Subscription',
  valueProposition: 'Widgets that never jam.',
  positioning: 'The dependable choice.',
};

const ACME_PROFILE = {
  name: 'Acme',
  description: 'We sell widgets to factories.',
  website: 'https://acme.test',
  industry: 'Manufacturing',
  businessModel: 'B2B',
  revenueModel: 'Subscription',
  valueProposition: 'Widgets that never jam.',
  positioning: 'The dependable choice.',
};

describe('get_business_context tool', () => {
  it('scopes the business lookup by the tenant workspace', async () => {
    const ctx = ctxWith(ACME, { currentVersion: { data: { companyProfile: { mission: 'm' } } } });
    const tool = createGetBusinessContextTool('b-1');

    await tool.execute({}, ctx);

    expect(ctx.prisma.business.findFirst).toHaveBeenCalledWith({
      where: { id: 'b-1', workspaceId: 'ws-1', deletedAt: null },
    });
  });

  it('returns the whole context when no section filter is given', async () => {
    const data = { companyProfile: { mission: 'm' }, products: [{ name: 'p' }] };
    const tool = createGetBusinessContextTool('b-1');

    const result = await tool.execute({}, ctxWith(ACME, { currentVersion: { data } }));

    expect(result).toEqual({ businessName: 'Acme', business: ACME_PROFILE, context: data });
  });

  it('returns only the requested sections when filtered', async () => {
    const data = { companyProfile: { mission: 'm' }, products: [{ name: 'p' }] };
    const tool = createGetBusinessContextTool('b-1');

    const result = await tool.execute(
      { sections: ['companyProfile'] },
      ctxWith(ACME, { currentVersion: { data } }),
    );

    expect(result).toEqual({
      businessName: 'Acme',
      business: ACME_PROFILE,
      context: { companyProfile: { mission: 'm' } },
    });
  });

  it('returns the business profile even when no context version exists', async () => {
    // Esta é a razão de o perfil estar aqui. Um negócio recém-cadastrado tem
    // description, positioning e valueProposition escritos pelo fundador e
    // NADA em context — e era exatamente isso que a tool descartava, deixando
    // o agente de seção sem nada de que destilar missão, visão, valores e tom.
    const tool = createGetBusinessContextTool('b-1');

    const result = await tool.execute({}, ctxWith(ACME, null));

    expect(result).toEqual({ businessName: 'Acme', business: ACME_PROFILE, context: {} });
  });

  it('omits profile fields the founder has not written', async () => {
    // Chave ausente diz "não sabemos" com menos ruído que `null`, e evita que
    // o modelo trate o nulo como um valor a reproduzir.
    const tool = createGetBusinessContextTool('b-1');

    const result = await tool.execute(
      {},
      ctxWith({ id: 'b-1', name: 'Acme', description: null, industry: 'Manufacturing' }, null),
    );

    expect(result).toEqual({
      businessName: 'Acme',
      business: { name: 'Acme', industry: 'Manufacturing' },
      context: {},
    });
  });

  it('reports a missing business as data, not as a thrown error', async () => {
    const tool = createGetBusinessContextTool('b-1');

    const result = await tool.execute({}, ctxWith(null, null));

    expect(result).toEqual({ error: 'business not found in this workspace' });
  });
});
