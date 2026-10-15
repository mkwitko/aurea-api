import { z, type ZodType } from 'zod';
import { EntityStatus } from '@prisma/client';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetBusinessContextTool } from '../../tools/get-business-context.js';
import { createGetIcpTool } from '../../tools/get-icp.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NoActiveIcpError, NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({ businessId: z.string().uuid(), icpId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

/**
 * `targetValue` e `deadline` não estão aqui: onde o fundador quer chegar, e
 * até quando, é a ambição dele. Um modelo que preenche isso inventa o objetivo
 * que deveria servir. Os dois são perguntados.
 */
const filledSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    metric: z.string().min(1).max(160).optional(),
    unit: z.string().min(1).max(40).optional(),
    baselineValue: z.number().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  })
  .strict();

export type GoalFilled = z.infer<typeof filledSchema>;
export type ProposeGoalOutput = FillOutput<GoalFilled>;

const FILLS = ['targetValue', 'deadline'] as const;

// O formulário do objetivo guarda `targetValue` como número e `deadline` como
// data ISO. Sem esta trava o modelo pede o alvo como `text`, a resposta entra
// como string e o Salvar do objetivo reprova — mesmo erro que derrubou uma
// seção inteira do contexto no run aaee7bac.
const ANSWER_TYPES = {
  targetValue: ['number', 'currency', 'percent', 'count'],
  deadline: ['text'],
} as const;

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth strategist for AUREA.',
  mission: 'Draft one measurable growth goal for this company and this customer profile.',
  toolRule: 'Call get_business_context and get_icp before answering. They are your only sources.',
  fills: FILLS,
  answerTypes: ANSWER_TYPES,
  extra: [
    'One goal, one metric. A goal with two numbers in it cannot be won or lost.',
    'baselineValue: only if the recorded context already holds that number. Never estimate it.',
    'Ask for the target and the deadline: where the founder wants to get to, and by when, is theirs to say.',
  ],
});

export const proposeGoalAgent: AgentDefinition<Input, ProposeGoalOutput> = {
  taskType: 'propose-goal',
  agentType: 'growth-strategist',
  tier: 'TIER2',
  budget: { maxToolIterations: 5, maxModelCalls: 7, maxOutputTokens: 6144 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS, ANSWER_TYPES) as unknown as ZodType<ProposeGoalOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    return [
      createGetBusinessContextTool(input.businessId) as unknown as Tool<never>,
      createGetIcpTool(input.icpId) as unknown as Tool<never>,
    ];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Draft the goal I should be chasing with this customer profile.' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const business = await prisma.business.findFirst({
      where: { id: input.businessId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!business) throw new NotFoundError('Business not found');

    // Filtrado por ACTIVE na própria consulta: um ICP arquivado é uma decisão
    // que o fundador já desfez, e uma meta contra ele não serve para nada.
    const icp = await prisma.icp.findFirst({
      where: { id: input.icpId, workspaceId: tenant.workspaceId, status: EntityStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!icp) throw new NoActiveIcpError();
  },
};
