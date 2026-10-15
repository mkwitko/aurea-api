import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetHypothesisTool } from '../../tools/get-hypothesis.js';
import { createGetLearningsTool } from '../../tools/get-learnings.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({ hypothesisId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

/**
 * Sem `baselineValue`, `targetValue`, `startDate` nem `endDate`: o número de
 * onde se parte, a barra a superar e quando o teste roda são do fundador. Um
 * baseline inventado envenena toda leitura posterior do resultado — e
 * `verifyEvidence`, no interpret-outcome, existe para impedir exatamente esse
 * tipo de número sem origem.
 *
 * `variables` também fica de fora: é um Json livre, e um objeto arbitrário
 * escrito pelo modelo é a única parte deste formulário sem forma que o
 * schema saiba conferir.
 */
const filledSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    metric: z.string().min(1).max(160).optional(),
    description: z.string().min(1).max(2000).optional(),
    objective: z.string().min(1).max(1000).optional(),
    channel: z.string().min(1).max(160).optional(),
    audience: z.string().min(1).max(500).optional(),
    successCriteria: z.string().min(1).max(1000).optional(),
  })
  .strict();

export type ExperimentFilled = z.infer<typeof filledSchema>;
export type ProposeExperimentOutput = FillOutput<ExperimentFilled>;

const FILLS = ['baselineValue', 'targetValue', 'startDate', 'endDate'] as const;

// A instrução do prompt sobre datas ("answerType text") virou trava: o modelo
// obedecia na maior parte das vezes, e uma resposta numérica num campo de data
// (ou uma data em texto num campo numérico) reprova o Salvar do experimento.
const ANSWER_TYPES = {
  baselineValue: ['number', 'currency', 'percent', 'count'],
  targetValue: ['number', 'currency', 'percent', 'count'],
  startDate: ['text'],
  endDate: ['text'],
} as const;

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth strategist for AUREA.',
  mission: 'Design one experiment that would test this hypothesis.',
  toolRule:
    'Call get_hypothesis and get_learnings before answering. They are your only sources. Do not design again a test a learning already ruled out.',
  fills: FILLS,
  answerTypes: ANSWER_TYPES,
  extra: [
    'metric: the same number the hypothesis targets. One metric, not several.',
    'description: when a past learning shaped this design, name it by its title. Never invent a learning that get_learnings did not return.',
    'successCriteria: what would have to be true for the hypothesis to survive, in words, without inventing a number.',
    'Ask for the baseline, the target and the dates. A number you made up would be read later as a measurement.',
    'startDate and endDate: ask for them as dates, using answerType "text", and say the format you expect.',
  ],
});

export const proposeExperimentAgent: AgentDefinition<Input, ProposeExperimentOutput> = {
  taskType: 'propose-experiment',
  agentType: 'growth-strategist',
  tier: 'TIER2',
  // description + objective + successCriteria no limite, mais quatro
  // perguntas: mesma margem estreita do propose-hypothesis.
  budget: { maxToolIterations: 5, maxModelCalls: 7, maxOutputTokens: 7168 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS, ANSWER_TYPES) as unknown as ZodType<ProposeExperimentOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    return [
      createGetHypothesisTool(input.hypothesisId) as unknown as Tool<never>,
      createGetLearningsTool() as unknown as Tool<never>,
    ];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Design the experiment that would test this hypothesis.' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const hypothesis = await prisma.hypothesis.findFirst({
      where: { id: input.hypothesisId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!hypothesis) throw new NotFoundError('Hypothesis not found');
  },
};
