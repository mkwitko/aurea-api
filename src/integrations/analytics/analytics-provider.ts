// O contrato existe separado da implementação pela mesma razão que o de busca
// (`search/search-provider.ts`): o princípio 5 do CLAUDE.md pede independência de
// fornecedor. Trocar GA4 por PostHog não pode exigir tocar no agente, na tool,
// nem no serviço que grava o Outcome.

export type MetricPeriod = { startDate: Date; endDate: Date };

export type MetricDescriptor = {
  /** Nome usável na consulta — `apiName` no GA4. */
  apiName: string;
  /** Nome que o humano vê na interface da fonte. */
  uiName: string;
  description: string;
  /** Criada pelo próprio cliente na property, não universal da fonte. */
  custom: boolean;
};

export type MetricReading = {
  value: number;
  /** Null quando a fonte não declara unidade — diferente de adimensional. */
  unit: string | null;
  /** O que foi lido, para auditoria: property + métrica. */
  externalRef: string;
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  query: unknown;
};

export interface AnalyticsProvider {
  readonly name: string;
  /** Passa em silêncio; lança com a mensagem da fonte quando a credencial não serve. */
  health(signal: AbortSignal): Promise<void>;
  listMetrics(signal: AbortSignal): Promise<{ metrics: MetricDescriptor[]; dimensions: MetricDescriptor[] }>;
  readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading>;
}

/**
 * Falha da fonte, não do domínio. Quem chama traduz para um `AppError` — o
 * conector não conhece HTTP status do nosso lado.
 */
export class AnalyticsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsProviderError';
  }
}
