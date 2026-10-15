import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';
import {
  createGa4Provider,
  minterFor,
  type MetricDescriptor,
} from '../../integrations/analytics/index.js';
import { createIntegrationsRepository } from '../../http/api/integrations/integrations.repository.js';
import { openIntegrationCredential } from '../../http/api/integrations/integrations.service.js';

// Sem argumentos: a fonte é a do workspace do run, nunca escolhida pelo modelo.
const argsSchema = z.object({});
type Args = z.infer<typeof argsSchema>;

/**
 * Um teto de prompt, e ele é declarado: 200 métricas e 200 dimensões com
 * descrição passam de 20 mil tokens. O corte não é silencioso — a saída diz
 * quantas ficaram fora, porque um modelo que não vê a métrica certa e não sabe
 * que ela existe propõe a mais parecida com convicção.
 */
const LIMIT = 80;

function trim(all: MetricDescriptor[]): { items: MetricDescriptor[]; omitted: number } {
  // As customizadas primeiro: é onde vive o vocabulário do próprio negócio, e é
  // o que o fundador tem mais chance de estar medindo.
  const ordered = [...all].sort((a, b) => Number(b.custom) - Number(a.custom));
  return { items: ordered.slice(0, LIMIT), omitted: Math.max(0, ordered.length - LIMIT) };
}

export function createListSourceMetricsTool(
  deps: { mintToken?: (authKind: string, credentials: string) => () => Promise<string> } = {},
): Tool<Args> {
  const minter = deps.mintToken ?? minterFor;

  return {
    name: 'list_source_metrics',
    description:
      'Returns the metrics and dimensions the connected analytics property actually has, including the ones this business defined itself. Call this before proposing a binding: a metric that is not in this list cannot be read.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const row = await createIntegrationsRepository(ctx.prisma).find(ctx.tenant.workspaceId, 'GA4');
      // Um erro devolvido, e não lançado: o run continua e o agente pode dizer
      // que não há fonte, em vez de morrer FAILED com o crédito gasto.
      if (!row) return { error: 'no analytics source is connected to this workspace' };
      // Devolvido, não lançado: o run continua e o agente diz o que falta, em
      // vez de morrer FAILED com o crédito gasto.
      if (!row.externalId) return { error: 'a data source is connected but no property has been chosen yet' };

      try {
        const provider = createGa4Provider({
          propertyId: row.externalId,
          mintToken: minter(row.authKind, openIntegrationCredential(row)),
        });
        const { metrics, dimensions } = await provider.listMetrics(ctx.signal);
        const m = trim(metrics);
        const d = trim(dimensions);
        return {
          propertyId: row.externalId,
          metrics: m.items,
          dimensions: d.items,
          omitted: { metrics: m.omitted, dimensions: d.omitted },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'could not read the source metadata' };
      }
    },
  };
}
