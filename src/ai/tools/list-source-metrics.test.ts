import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListSourceMetricsTool } from './list-source-metrics.js';
import { seal } from '../../billing/crypto.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' as const };

const integration = {
  id: 'int-1',
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  externalId: '123',
  ciphertext: Buffer.from('c'),
  iv: Buffer.from('i'),
  authTag: Buffer.from('t'),
};

const ctx = (integrationRow: unknown) => ({
  tenant: TENANT,
  prisma: { workspaceIntegration: { findFirst: vi.fn().mockResolvedValue(integrationRow) } } as never,
  signal: AbortSignal.timeout(5_000),
});

/** O minter injetado: assinar JWT de verdade exigiria uma chave real. */
const fakeMinter = () => async () => 'fake-token';

function stubMetadata(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ),
  );
}

/** `openIntegrationCredential` é exercitado de verdade: o segredo é selado aqui. */
function sealedIntegration() {
  const sealed = seal(JSON.stringify({ client_email: 'aurea@p.iam.gserviceaccount.com', private_key: 'pk' }));
  return { ...integration, ...sealed };
}

afterEach(() => vi.unstubAllGlobals());

describe('list_source_metrics', () => {
  // Erro devolvido, não lançado: o run continua e o agente pode dizer que não há
  // fonte, em vez de morrer FAILED com o crédito já gasto.
  it('diz que não há fonte conectada em vez de falhar o run', async () => {
    const result = await createListSourceMetricsTool({ mintToken: fakeMinter }).execute({}, ctx(null));

    expect(result).toEqual({ error: 'no analytics source is connected to this workspace' });
  });

  it('devolve as métricas e dimensões da property', async () => {
    stubMetadata({
      metrics: [{ apiName: 'conversions', uiName: 'Conversions', description: 'Conversion events.' }],
      dimensions: [{ apiName: 'eventName', uiName: 'Event name', description: 'The name of the event.' }],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { propertyId: string; metrics: { apiName: string }[]; omitted: { metrics: number } };

    expect(result.propertyId).toBe('123');
    expect(result.metrics[0]!.apiName).toBe('conversions');
    expect(result.omitted.metrics).toBe(0);
  });

  // O corte não pode ser silencioso: um modelo que não vê a métrica certa e não
  // sabe que ela existe propõe a mais parecida com convicção.
  it('declara quantas métricas ficaram fora do corte', async () => {
    stubMetadata({
      metrics: Array.from({ length: 95 }, (_, i) => ({ apiName: `m${i}`, uiName: `M ${i}` })),
      dimensions: [],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { metrics: unknown[]; omitted: { metrics: number } };

    expect(result.metrics).toHaveLength(80);
    expect(result.omitted.metrics).toBe(15);
  });

  // As customizadas primeiro: é onde vive o vocabulário do próprio negócio.
  it('põe as métricas customizadas na frente do corte', async () => {
    stubMetadata({
      metrics: [
        ...Array.from({ length: 80 }, (_, i) => ({ apiName: `m${i}`, uiName: `M ${i}`, customDefinition: false })),
        { apiName: 'customEvent:activated', uiName: 'Activated', customDefinition: true },
      ],
      dimensions: [],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { metrics: { apiName: string }[] };

    expect(result.metrics[0]!.apiName).toBe('customEvent:activated');
  });

  it('devolve a mensagem da fonte quando a leitura falha', async () => {
    stubMetadata({ error: { message: 'Caller does not have permission.' } }, 403);

    const result = await createListSourceMetricsTool({ mintToken: fakeMinter }).execute({}, ctx(sealedIntegration()));

    expect(result).toEqual({ error: 'Caller does not have permission.' });
  });
});
