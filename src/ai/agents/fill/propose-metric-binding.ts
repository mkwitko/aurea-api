import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { createGetExperimentResultTool } from '../../tools/get-experiment-result.js';
import { createListSourceMetricsTool } from '../../tools/list-source-metrics.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({ experimentId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

const outputSchema = z
  .object({
    /**
     * Null quando nenhuma métrica da property responde pela métrica do
     * experimento. É resposta, não falha — e a alternativa (escolher a mais
     * parecida) erra todos os números daquele experimento para sempre.
     */
    binding: z
      .object({
        metric: z.string().min(1).max(160),
        dimensionFilter: z
          .object({ fieldName: z.string().min(1).max(160), value: z.string().min(1).max(200) })
          .nullable()
          .default(null),
      })
      .strict()
      .nullable(),
    /** Obrigatório nos dois casos: sem motivo, o humano não tem o que conferir. */
    rationale: z.string().min(1).max(1000),
  })
  .strict();

export type ProposeMetricBindingOutput = z.infer<typeof outputSchema>;

const SYSTEM = [
  'You are a growth analyst for AUREA.',
  'Your job: say which metric of the connected analytics property answers for this experiment’s metric.',
  'Call get_experiment_result and list_source_metrics before answering. They are your only sources.',
  'The experiment’s `metric` is free text written by the founder. Your job is to map it, not to judge it.',
  'metric: must be an apiName that list_source_metrics returned. A metric that is not in that list cannot be read, and naming one is worse than naming none.',
  'dimensionFilter: only when the metric alone would count more than the experiment measures — for example eventCount filtered to one eventName. Otherwise null.',
  'If the property has no metric that answers for this experiment, return binding: null and say in rationale where that number would have to come from instead. Never pick the closest-looking metric.',
  'If list_source_metrics reported omitted metrics, say so in rationale: the founder may need to look for one you could not see.',
  'rationale: one short paragraph, addressed to the founder, in the language of the experiment.',
].join('\n');

export const proposeMetricBindingAgent: AgentDefinition<Input, ProposeMetricBindingOutput> = {
  taskType: 'propose-metric-binding',
  agentType: 'analyst',
  tier: 'TIER1',
  // Uma leitura do experimento, uma da property, uma resposta curta. O teto de
  // saída sai do próprio schema (ai/runner/output-budget.ts).
  budget: { maxToolIterations: 4, maxModelCalls: 5, maxOutputTokens: 2048 },
  requiresSearch: false,
  inputSchema,
  // `dimensionFilter.default(null)` faz o tipo de entrada do Zod (opcional)
  // diferir do tipo de saída (sempre presente), e ZodType<O> exige os dois
  // iguais. Mesmo desvio de research-growth-context.ts — validateOutput sempre
  // chama schema.safeParse(unknown), então a divergência não muda nada em
  // runtime.
  outputSchema: outputSchema as unknown as ZodType<ProposeMetricBindingOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    return [
      createGetExperimentResultTool(input.experimentId) as unknown as Tool<never>,
      createListSourceMetricsTool() as unknown as Tool<never>,
    ];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Which metric of my analytics property should measure this experiment?' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const experiment = await prisma.experiment.findFirst({
      where: { id: input.experimentId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!experiment) throw new NotFoundError('Experiment not found');
    // Sem fonte conectada não há o que propor, e recusar aqui é recusar antes de
    // cobrar o crédito — é para isso que o precheck existe.
    const integration = await prisma.workspaceIntegration.findFirst({
      where: { workspaceId: tenant.workspaceId, provider: 'GA4' },
      select: { id: true },
    });
    if (!integration) throw new NotFoundError('No analytics source is connected');
  },
};
