import { z } from 'zod';
import {
  AnalyticsProviderError,
  type AnalyticsProvider,
  type MetricDescriptor,
  type MetricPeriod,
  type MetricReading,
} from '../analytics-provider.js';

const BASE = 'https://analyticsdata.googleapis.com/v1beta';

/** A amarração que este provider entende. Validada aqui, não confiada. */
export const ga4ConfigSchema = z.object({
  metric: z.string().min(1).max(160),
  dimensionFilter: z
    .object({ fieldName: z.string().min(1).max(160), value: z.string().min(1).max(200) })
    .nullish(),
});

export type Ga4Config = z.infer<typeof ga4ConfigSchema>;

/** Um descritor do metadata. `description` é opcional na resposta real. */
const descriptorSchema = z.object({
  apiName: z.string(),
  uiName: z.string(),
  description: z.string().optional(),
  customDefinition: z.boolean().optional(),
});

const metadataSchema = z.object({
  metrics: z.array(descriptorSchema).default([]),
  dimensions: z.array(descriptorSchema).default([]),
});

const reportSchema = z.object({
  // Ausente quando a consulta não casou nada. Zero linhas é uma resposta, não
  // uma falha.
  rowCount: z.number().optional(),
  totals: z
    .array(z.object({ metricValues: z.array(z.object({ value: z.string() })) }))
    .optional(),
});

/** YYYY-MM-DD em UTC — a mesma fronteira de dia de `experiments.clock.ts`. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDescriptor(raw: z.infer<typeof descriptorSchema>): MetricDescriptor {
  return {
    apiName: raw.apiName,
    uiName: raw.uiName,
    description: raw.description ?? '',
    custom: raw.customDefinition ?? false,
  };
}

export function createGa4Provider(deps: { propertyId: string; mintToken: () => Promise<string> }): AnalyticsProvider {
  const { propertyId, mintToken } = deps;

  async function call(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const token = await mintToken();
    const response = await fetch(`${BASE}/properties/${propertyId}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });

    if (!response.ok) {
      // A mensagem da própria fonte, quando ela dá uma: "Caller does not have
      // permission" diz ao fundador o que fazer; "status 403" não diz nada.
      const detail = await response
        .json()
        .then((json: unknown) => {
          const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(json);
          return parsed.success ? parsed.data.error.message : null;
        })
        .catch(() => null);
      throw new AnalyticsProviderError(detail ?? `ga4 request failed with status ${response.status}`);
    }

    try {
      return await response.json();
    } catch {
      throw new AnalyticsProviderError('ga4 returned a response body that is not valid JSON');
    }
  }

  return {
    name: 'ga4',

    async health(signal: AbortSignal): Promise<void> {
      // O metadata é a leitura mais barata que já exige credencial válida e
      // acesso à property: se ele passa, uma medição vai passar.
      const parsed = metadataSchema.safeParse(await call('/metadata', signal));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable metadata');
    },

    async listMetrics(signal: AbortSignal) {
      const parsed = metadataSchema.safeParse(await call('/metadata', signal));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable metadata');
      return {
        metrics: parsed.data.metrics.map(toDescriptor),
        dimensions: parsed.data.dimensions.map(toDescriptor),
      };
    },

    async readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading> {
      // Antes de qualquer chamada: uma amarração malformada não pode virar uma
      // consulta pela metade contra a property do cliente.
      const valid = ga4ConfigSchema.safeParse(config);
      if (!valid.success) throw new AnalyticsProviderError('the metric binding is not a valid ga4 binding');

      const query = {
        dateRanges: [{ startDate: utcDay(period.startDate), endDate: utcDay(period.endDate) }],
        metrics: [{ name: valid.data.metric }],
        ...(valid.data.dimensionFilter
          ? {
              dimensionFilter: {
                filter: {
                  fieldName: valid.data.dimensionFilter.fieldName,
                  stringFilter: { value: valid.data.dimensionFilter.value },
                },
              },
            }
          : {}),
        // Sem `dimensions`: a leitura quer um número do período inteiro, não uma
        // série. O valor sai do total agregado.
        metricAggregations: ['TOTAL'],
      };

      const parsed = reportSchema.safeParse(await call(':runReport', signal, query));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned an unreadable report');

      const raw = parsed.data.totals?.[0]?.metricValues?.[0]?.value;
      // Nenhuma linha no período: a fonte respondeu zero. Diferente de "não deu
      // para ler", e a diferença importa — ver spec §9.
      if (raw === undefined) {
        if ((parsed.data.rowCount ?? 0) === 0) {
          return { value: 0, unit: null, externalRef: `properties/${propertyId}:${valid.data.metric}`, query };
        }
        throw new AnalyticsProviderError('ga4 returned a report without a total');
      }

      const value = Number(raw);
      if (!Number.isFinite(value)) throw new AnalyticsProviderError(`ga4 returned a non-numeric total: ${raw}`);

      return {
        value,
        // O GA4 Data API não declara unidade por métrica no report; quem sabe a
        // unidade é o fundador, e ele a informa no Outcome.
        unit: null,
        externalRef: `properties/${propertyId}:${valid.data.metric}`,
        query,
      };
    },
  };
}
