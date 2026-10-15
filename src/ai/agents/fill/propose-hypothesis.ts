import { z, type ZodType } from 'zod';
import { StrategyStatus } from '@prisma/client';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetStrategyTool } from '../../tools/get-strategy.js';
import { createGetLearningsTool } from '../../tools/get-learnings.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError, StrategyNotSelectedError } from '../../../lib/errors.js';

const inputSchema = z.object({ strategyId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

// `strategyId` não está aqui: ele vem do input do run. Um modelo que escolhe a
// que estratégia a hipótese pertence é um modelo escolhendo onde escrever.
const filledSchema = z
  .object({
    statement: z.string().min(1).max(2000).optional(),
    rationale: z.string().min(1).max(2000).optional(),
    expectedOutcome: z.string().min(1).max(1000).optional(),
    targetMetric: z.string().min(1).max(160).optional(),
    // VERIFIED existe no ConfidenceLevel do Prisma e fica de fora: uma
    // hipótese que ninguém testou não verificou nada.
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  })
  .strict();

export type HypothesisFilled = z.infer<typeof filledSchema>;
export type ProposeHypothesisOutput = FillOutput<HypothesisFilled>;

const FILLS: readonly string[] = [];

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth strategist for AUREA.',
  mission: 'Draft one testable hypothesis for the strategy the founder has chosen.',
  toolRule:
    'Call get_strategy and get_learnings before answering. They are your only sources. Do not restate a hypothesis a learning already ruled out.',
  fills: FILLS,
  extra: [
    'statement: one sentence of the form "doing X will move Y, because Z". It must be possible for it to turn out false.',
    'targetMetric: the single number that would move if the statement is true.',
    'confidence: how much the strategy\'s own evidence supports the statement, before any test.',
    'rationale: when a past learning supports or weakens this hypothesis, name it by its title. Never invent a learning that get_learnings did not return.',
  ],
});

export const proposeHypothesisAgent: AgentDefinition<Input, ProposeHypothesisOutput> = {
  taskType: 'propose-hypothesis',
  agentType: 'growth-strategist',
  tier: 'TIER2',
  // statement + rationale + expectedOutcome no limite do schema já passam de
  // 1500 tokens; 2048 não deixava margem para o corretivo.
  budget: { maxToolIterations: 5, maxModelCalls: 6, maxOutputTokens: 3072 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS) as unknown as ZodType<ProposeHypothesisOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    return [
      createGetStrategyTool(input.strategyId) as unknown as Tool<never>,
      createGetLearningsTool() as unknown as Tool<never>,
    ];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Draft the hypothesis I should test first under this strategy.' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const strategy = await prisma.strategy.findFirst({
      where: { id: input.strategyId, workspaceId: tenant.workspaceId },
      select: { status: true },
    });
    if (!strategy) throw new NotFoundError('Strategy not found');
    // APPROVED e ACTIVE são os dois estados em que alguém disse "é este o
    // plano". Sob qualquer outro, uma hipótese não testa nada que foi decidido.
    const chosen: StrategyStatus[] = [StrategyStatus.APPROVED, StrategyStatus.ACTIVE];
    if (!chosen.includes(strategy.status)) throw new StrategyNotSelectedError();
  },
};
