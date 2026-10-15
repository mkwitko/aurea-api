import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError, NoMetricBindingError, MeasurementReadFailedError } from '../../../../lib/errors.js';
import { measurementProposalRoute } from './measurement-proposal.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const READING = {
  value: 42,
  unit: null,
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-14T00:00:00Z'),
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
  source: 'GA4',
};

beforeEach(() => vi.clearAllMocks());

/**
 * O leitor entra por opção de plugin. Sem isto o teste construiria o leitor
 * real e sairia chamando o Google de dentro da suíte.
 */
async function buildApp(read: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', {} as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(measurementProposalRoute, { read });
  return app;
}

const url = `/experiments/${EXPERIMENT_ID}/measurement-proposal`;

describe('GET /experiments/:id/measurement-proposal', () => {
  it('devolve o número, o período, a fonte e a consulta', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      value: 42,
      unit: null,
      externalRef: 'properties/123456789:conversions',
      source: 'GA4',
      query: { metrics: [{ name: 'conversions' }] },
    });
  });

  it('lê com o workspace do tenant, nunca com um id do caminho', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    await app.inject({ method: 'GET', url });

    expect(read).toHaveBeenCalledWith(WORKSPACE_ID, EXPERIMENT_ID, expect.anything());
  });

  // Transitória de propósito: confirmar é o POST /outcomes que já existe. Uma
  // rota GET que gravasse criaria Outcome sem confirmação humana (spec §7).
  it('não persiste nada', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    // Nenhuma escrita possível: o app foi montado com um prisma vazio, então
    // qualquer tentativa de gravar teria estourado antes de responder 200.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('propaga a recusa do leitor com o código dela', async () => {
    const read = vi.fn().mockRejectedValue(new NoMetricBindingError());
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0036');
  });

  it('propaga a mensagem da fonte quando ela recusa', async () => {
    const read = vi.fn().mockRejectedValue(new MeasurementReadFailedError({ reason: 'Property not found.' }));
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0039', details: { reason: 'Property not found.' } });
  });

  it('devolve zero como zero', async () => {
    const read = vi.fn().mockResolvedValue({ ...READING, value: 0 });
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(0);
  });

  it('recusa um id que não é uuid antes de chamar o leitor', async () => {
    const read = vi.fn();
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url: '/experiments/nope/measurement-proposal' });

    expect(res.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});
