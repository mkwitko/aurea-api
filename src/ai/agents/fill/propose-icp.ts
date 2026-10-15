import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetBusinessContextTool } from '../../tools/get-business-context.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { BusinessContextTooEmptyError, NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({ businessId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

// Tetos do icpCreateBody: uma proposta que o formulário recusa é crédito gasto
// à toa.
const list = (max: number) => z.array(z.string().min(1).max(200)).max(max).optional();

const filledSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().min(1).max(2000).optional(),
    painPoints: list(6),
    characteristics: list(6),
    customerGoals: list(6),
    buyingTriggers: list(6),
    objections: list(6),
  })
  .strict();

export type IcpFilled = z.infer<typeof filledSchema>;
export type ProposeIcpOutput = FillOutput<IcpFilled>;

// Nada aqui é privado do fundador: um ICP é uma leitura do contexto que o
// próprio fundador já gravou. O precheck garante que haja contexto suficiente;
// além disso, não há o que perguntar.
const FILLS: readonly string[] = [];

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth strategist for AUREA.',
  mission: 'Draft the ideal customer profile this company should be selling to, from its own recorded context.',
  toolRule: 'Call get_business_context first. It is your only source.',
  fills: FILLS,
  extra: [
    'name: who they are in one line, as the founder would say it to a friend.',
    'Write about the customer, never about the product.',
    'Every point must trace back to something in the recorded context. A generic buyer persona is worse than an empty field.',
    // Encurtar antes de ser cortado: um rascunho longo estoura o teto de saída
    // no meio do submit_answer e o run termina sem ICP nenhum.
    'Be brief: at most four items per list, one short line each, and a description under 800 characters. A long draft is cut off before it finishes.',
  ],
});

/** Quantas seções do contexto têm conteúdo de verdade. */
function filledSectionCount(data: Record<string, unknown>): number {
  return Object.entries(data).filter(([key, value]) => {
    if (['completeness', 'lastReviewedAt', 'notes'].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }).length;
}

export const proposeIcpAgent: AgentDefinition<Input, ProposeIcpOutput> = {
  taskType: 'propose-icp',
  agentType: 'growth-strategist',
  tier: 'TIER2',
  // 2048 não cabia o ICP máximo que o próprio schema aceita: descrição de
  // 2000 caracteres mais cinco listas de seis itens de 200 passam de 2000
  // tokens só em `filled`, e o submit_answer saía cortado no meio. Com o
  // teto em 3 iterações, as duas tentativas seguintes (o guardrail pede uma
  // resposta menor) não caíam: o run morria com o crédito estornado e o
  // fundador sem ICP. Teto que caiba o pior caso, e iterações para o pedido
  // de encurtar ter onde acontecer.
  budget: { maxToolIterations: 6, maxModelCalls: 8, maxOutputTokens: 4096 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS) as unknown as ZodType<ProposeIcpOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    return [createGetBusinessContextTool(input.businessId) as unknown as Tool<never>];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Read my business context and draft who I should be selling to.' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const business = await prisma.business.findFirst({
      where: { id: input.businessId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!business) throw new NotFoundError('Business not found');

    const context = await prisma.businessContext.findUnique({
      where: { businessId: input.businessId },
      include: { currentVersion: true },
    });

    // Narrowing of a Prisma JSON column, not unvalidated external input.
    const data = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;
    // Três é o mínimo em que um ICP deixa de ser persona genérica. Abaixo
    // disso o run devolveria um retrato de qualquer empresa, cobrado.
    if (filledSectionCount(data) < 3) throw new BusinessContextTooEmptyError();
  },
};
