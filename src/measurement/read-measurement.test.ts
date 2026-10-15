import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsProviderError } from '../integrations/analytics/index.js';
import { seal } from '../billing/crypto.js';
import { createMeasurementReader } from './read-measurement.js';

const WORKSPACE_ID = 'ws-1';
const EXPERIMENT_ID = 'exp-1';

const SEALED = seal(JSON.stringify({ client_email: 'aurea@p.iam.gserviceaccount.com', private_key: 'pk' }));

const INTEGRATION = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: '123456789',
  accountLabel: 'aurea@p.iam.gserviceaccount.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00Z'),
  lastError: null,
};

const BINDING = {
  id: 'mb-1',
  workspaceId: WORKSPACE_ID,
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
};

const EXPERIMENT = {
  id: EXPERIMENT_ID,
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-14T00:00:00Z'),
};

/**
 * `'key' in over`, e não `??`: os casos negativos passam `null` de propósito, e
 * `??` devolveria o default de qualquer jeito — o teste passaria sem que a
 * recusa existisse.
 */
function prismaFake(over: { experiment?: unknown; binding?: unknown; integration?: unknown } = {}) {
  return {
    experiment: {
      findFirst: vi.fn().mockResolvedValue('experiment' in over ? over.experiment : EXPERIMENT),
    },
    metricBinding: {
      findFirst: vi.fn().mockResolvedValue('binding' in over ? over.binding : BINDING),
    },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
      update: vi.fn().mockResolvedValue(INTEGRATION),
    },
  };
}

const READING = {
  value: 42,
  unit: null,
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
};

function providerFake(readMetric = vi.fn().mockResolvedValue(READING)) {
  return {
    readMetric,
    factory: vi.fn().mockReturnValue({
      name: 'ga4',
      health: vi.fn(),
      listMetrics: vi.fn(),
      readMetric,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

const signal = () => AbortSignal.timeout(1000);

describe('createMeasurementReader', () => {
  it('lê a métrica amarrada no período declarado do experimento', async () => {
    const provider = providerFake();
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: provider.factory });

    const result = await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(result).toMatchObject({
      value: 42,
      unit: null,
      externalRef: 'properties/123456789:conversions',
      source: 'GA4',
    });
    expect(result.periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(result.periodEnd.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    // O período vai para o conector como as datas do experimento, não como uma
    // janela derivada de "hoje": duas regras de período mediriam testes
    // diferentes (spec §7).
    expect(provider.readMetric).toHaveBeenCalledWith(
      BINDING.config,
      { startDate: EXPERIMENT.startDate, endDate: EXPERIMENT.endDate },
      expect.anything(),
    );
  });

  it('abre a credencial selada e monta o provider com a property gravada', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(provider.factory).toHaveBeenCalledWith({
      propertyId: '123456789',
      credentials: expect.stringContaining('private_key'),
      authKind: 'SERVICE_ACCOUNT',
    });
  });

  it('lê apenas dentro do workspace do tenant', async () => {
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: providerFake().factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID } }),
    );
    expect(prisma.metricBinding.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });

  it('um experimento de outro workspace é indistinguível de inexistente', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({ experiment: null }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({ code: 'AUR-T0005' });
  });

  // As três recusas de setup, com códigos distintos: a tela precisa saber se
  // pede amarração, conexão ou datas (spec §9 e §11).
  it('recusa sem amarração, com código próprio', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ binding: null }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0036',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('recusa sem fonte conectada, com código próprio', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({ integration: null }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0037',
      statusCode: 400,
    });
  });

  it('recusa sem período declarado, e não inventa um', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ experiment: { id: EXPERIMENT_ID, startDate: null, endDate: null } }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0038',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('recusa quando só uma das duas datas existe', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({
        experiment: { id: EXPERIMENT_ID, startDate: new Date('2026-07-01T00:00:00Z'), endDate: null },
      }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({ code: 'AUR-T0038' });
  });

  // `minterFor` recusa um authKind desconhecido e recusa OAUTH num servidor que
  // perdeu a variável de ambiente — e isso é montar o conector, não ler. Fora de
  // um try, sairia como 500 sem mensagem.
  it('recusa nomeada quando montar o conector falha, e não marca a integração como FAILED', async () => {
    const prisma = prismaFake();
    const read = createMeasurementReader({
      prisma: prisma as never,
      createProvider: vi.fn(() => {
        throw new AnalyticsProviderError('google oauth is not configured in this environment');
      }),
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0039',
      details: { reason: 'google oauth is not configured in this environment' },
    });
    // A credencial está boa; o servidor está mal configurado. Marcar FAILED
    // mandaria o fundador reconectar o que não está quebrado.
    expect(prisma.workspaceIntegration.update).not.toHaveBeenCalled();
  });

  it('grava FAILED com a mensagem da própria fonte quando a leitura é recusada', async () => {
    const provider = providerFake(
      vi.fn().mockRejectedValue(new AnalyticsProviderError('Caller does not have permission.')),
    );
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: provider.factory });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0039',
      // A mensagem da fonte chega ao fundador nos detalhes: "Caller does not
      // have permission" diz o que fazer; "falha ao medir" não diz nada.
      details: { reason: 'Caller does not have permission.' },
    });
    expect(prisma.workspaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'int-1' },
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Caller does not have permission.' }),
      }),
    );
  });

  // Zero é uma resposta. Ele sobe como 0 e não como recusa — confundir os dois é
  // como o tracking quebrado entra no Growth Brain disfarçado de resultado ruim.
  it('devolve zero como leitura, não como falha', async () => {
    const provider = providerFake(vi.fn().mockResolvedValue({ ...READING, value: 0 }));
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).resolves.toMatchObject({ value: 0 });
  });

  // Conectado e sem property escolhida é um estado real — o intervalo entre
  // autorizar no Google e escolher a property. Devolver "nenhuma fonte
  // conectada" aqui mandaria o fundador conectar o que já está conectado.
  it('recusa com código próprio quando a fonte está conectada sem property', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ integration: { ...INTEGRATION, externalId: null } }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0040',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('passa o authKind da linha para a fábrica do provider', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(provider.factory).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: '123456789', authKind: 'SERVICE_ACCOUNT' }),
    );
  });
});
