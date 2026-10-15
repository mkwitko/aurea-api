import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsProviderError } from '../analytics-provider.js';
import { createGa4Provider } from './ga4-provider.js';

const PROPERTY = '123456789';
const PERIOD = { startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-14T00:00:00.000Z') };

const provider = () => createGa4Provider({ propertyId: PROPERTY, mintToken: async () => 'fake-token' });

/** Uma resposta HTTP falsa, e o registro do que foi pedido. */
function stub(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('createGa4Provider.readMetric', () => {
  it('lê o total do período e devolve a consulta que o produziu', async () => {
    const calls = stub(200, { totals: [{ metricValues: [{ value: '42' }] }], rowCount: 1 });

    const reading = await provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000));

    expect(reading.value).toBe(42);
    expect(reading.externalRef).toBe(`properties/${PROPERTY}:conversions`);
    expect(calls[0]!.url).toBe(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      // Datas em YYYY-MM-DD UTC: a mesma fronteira de dia que experiments.clock.ts
      // usa. Duas regras de dia divergindo mediriam um período diferente do que o
      // relógio fechou.
      dateRanges: [{ startDate: '2026-08-01', endDate: '2026-08-14' }],
      metrics: [{ name: 'conversions' }],
      metricAggregations: ['TOTAL'],
    });
    expect(calls[0]!.init?.headers).toMatchObject({ authorization: 'Bearer fake-token' });
  });

  it('manda o filtro de dimensão quando a amarração tem um', async () => {
    const calls = stub(200, { totals: [{ metricValues: [{ value: '7' }] }], rowCount: 1 });

    await provider().readMetric(
      { metric: 'eventCount', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
      PERIOD,
      AbortSignal.timeout(5_000),
    );

    expect(JSON.parse(String(calls[0]!.init?.body)).dimensionFilter).toEqual({
      filter: { fieldName: 'eventName', stringFilter: { value: 'sign_up' } },
    });
  });

  // Zero não é falha de leitura. Confundir os dois é como tracking quebrado
  // entra no Growth Brain disfarçado de resultado ruim (spec §9).
  it('devolve zero quando a fonte respondeu zero, em vez de erro', async () => {
    stub(200, { rowCount: 0 });

    const reading = await provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000));

    expect(reading.value).toBe(0);
  });

  it('recusa credencial inválida sem inventar número', async () => {
    stub(401, { error: { message: 'Request had invalid authentication credentials.' } });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  it('recusa property inexistente ou sem permissão', async () => {
    stub(404, { error: { message: 'Property not found.' } });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  // Um contrato quebrado tem de falhar aqui. Sem isto, `undefined` viraria
  // `NaN` e `NaN` viraria um Outcome.
  it('recusa um corpo que não tem a forma esperada', async () => {
    stub(200, { totals: [{ metricValues: [{ value: 'não é número' }] }], rowCount: 1 });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  it('recusa uma amarração malformada antes de chamar a fonte', async () => {
    const calls = stub(200, {});

    await expect(provider().readMetric({}, PERIOD, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(
      AnalyticsProviderError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('createGa4Provider.listMetrics', () => {
  it('mapeia o metadata da property para descritores', async () => {
    const calls = stub(200, {
      name: `properties/${PROPERTY}/metadata`,
      metrics: [
        { apiName: 'conversions', uiName: 'Conversions', description: 'The count of conversion events.', customDefinition: false },
      ],
      dimensions: [
        { apiName: 'eventName', uiName: 'Event name', description: 'The name of the event.', customDefinition: false },
        { apiName: 'customUser:plan', uiName: 'Plan', description: 'Custom.', customDefinition: true },
      ],
    });

    const { metrics, dimensions } = await provider().listMetrics(AbortSignal.timeout(5_000));

    expect(calls[0]!.url).toBe(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}/metadata`);
    expect(metrics).toEqual([
      { apiName: 'conversions', uiName: 'Conversions', description: 'The count of conversion events.', custom: false },
    ]);
    expect(dimensions[1]!.custom).toBe(true);
  });

  // `description` é opcional na resposta real; sem o default o descritor
  // chegaria com `undefined` num campo que o tipo declara string.
  it('aceita metadata sem descrição', async () => {
    stub(200, { metrics: [{ apiName: 'sessions', uiName: 'Sessions' }], dimensions: [] });

    expect((await provider().listMetrics(AbortSignal.timeout(5_000))).metrics[0]!.description).toBe('');
  });
});

describe('createGa4Provider.health', () => {
  it('passa quando o metadata responde', async () => {
    stub(200, { metrics: [], dimensions: [] });

    await expect(provider().health(AbortSignal.timeout(5_000))).resolves.toBeUndefined();
  });

  it('falha com a mensagem da fonte quando a credencial não serve', async () => {
    stub(403, { error: { message: 'Caller does not have permission.' } });

    await expect(provider().health(AbortSignal.timeout(5_000))).rejects.toThrow(/permission/i);
  });
});
