import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { fillSystemPrompt } from './contract.js';
import {
  CONTEXT_FILL_ANSWER_TYPES,
  isProposableSection,
  PROPOSABLE_SECTIONS,
  type ProposableSection,
  SECTION_FIELD,
  SECTION_FILLS,
} from './context-sections.js';
import { contextOutputSchema, type ProposeContextOutput } from './propose-business-context.js';
import { createGetBusinessContextTool } from '../../tools/get-business-context.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError, SectionNotProposableError } from '../../../lib/errors.js';

const inputSchema = z.object({
  businessId: z.string().uuid(),
  section: z.enum(PROPOSABLE_SECTIONS),
});
type Input = z.infer<typeof inputSchema>;
export type ProposeContextSectionInput = Input;

/**
 * Um prompt por seção, não um compartilhado.
 *
 * `fills` recebe só as entradas da seção pedida: a lista inteira convidava o
 * modelo a escolher um destino de outra seção — legal pelo enum da tool,
 * reprovado pelo verifySection — e a tentativa morria depois de paga. Nas três
 * seções sem entrada própria a lista fica vazia, e é o próprio
 * `fillSystemPrompt` que então manda `questions` ser um array vazio, em vez de
 * o modelo descobrir isso gastando chamadas.
 */
const SYSTEM_BY_SECTION = Object.fromEntries(
  PROPOSABLE_SECTIONS.map((section) => [
    section,
    fillSystemPrompt({
      role: 'You are an onboarding analyst for AUREA.',
      mission: `Fill in the ${section} section of this company's business context, using what is already recorded.`,
      toolRule: 'Call get_business_context first. It is your only source — you have no web search in this run.',
      fills: SECTION_FILLS[section],
      answerTypes: CONTEXT_FILL_ANSWER_TYPES,
      extra: [
        `Fill and ask about the ${section} section only, which writes to "${SECTION_FIELD[section]}". Anything you write about another section is discarded and the whole result is rejected.`,
        // Sem esta linha o modelo lê "nunca invente um valor" e devolve a
        // seção vazia com um perfil inteiro na mão: destilar a descrição do
        // fundador em missão e tom de marca parece inventar, e não é.
        'The `business` object from get_business_context is the founder\'s own words about the company — description, industry, business model, revenue model, value proposition, positioning. It is evidence. Distill it into the fields of your section: a mission, a brand voice or a set of values that the founder\'s own text supports is a filled field, not an invented one.',
        'Distilling is restating what the profile says in the shape the field wants. Adding a fact that appears in neither the profile nor the stored context is inventing — that is what you never do.',
        'Never contradict something already recorded. If you disagree with a stored value, leave the field out and ask about it instead.',
        'Money the founder alone knows — revenue, customers, cancellations, ad spend — is never something you fill. Ask.',
        'get_business_context is your only source and it does not change between calls. Call it once; calling it again wastes the run.',
      ],
    }),
  ]),
) as Record<ProposableSection, string>;

/**
 * Recusa uma saída que vaza para fora da seção pedida.
 *
 * O outputSchema de um AgentDefinition é estático, então ele não tem como
 * estreitar para a seção que ESTE run pediu — por isso a checagem mora aqui,
 * onde o input do run está disponível. Ela entra no mesmo laço de correção do
 * guardrail: a reprovação volta como mensagem e o modelo se corrige dentro do
 * orçamento, em vez de o cliente filtrar em silêncio algo que já foi pago.
 */
export function verifySection(
  output: ProposeContextOutput,
  _toolResults: readonly unknown[],
  input: Input,
): { ok: true } | { ok: false; feedback: string } {
  const field: string = SECTION_FIELD[input.section];

  const strayField = Object.keys(output.filled).find((key) => key !== field);
  if (strayField) {
    return {
      ok: false,
      feedback:
        `This run is about the ${input.section} section only, which writes to "${field}". ` +
        `You filled "${strayField}". Remove it and return only ${field}.`,
    };
  }

  const strayQuestion = output.questions.find((question) => !question.fills.startsWith(`${field}.`));
  if (strayQuestion) {
    return {
      ok: false,
      feedback:
        `This run is about the ${input.section} section only. Question "${strayQuestion.id}" fills ` +
        `"${strayQuestion.fills}", which belongs to another section. Ask only about ${field}.`,
    };
  }

  return { ok: true };
}

export const proposeContextSectionAgent: AgentDefinition<Input, ProposeContextOutput> = {
  taskType: 'propose-context-section',
  agentType: 'onboarding-analyst',
  tier: 'TIER2',
  // Uma tool e uma seção, mas nenhuma das duas folgas pode ser apertada com um
  // modelo de raciocínio. maxOutputTokens conta o reasoning junto da resposta:
  // com 2048, um run gastou 2040 tokens pensando e emitiu 36 caracteres de
  // argumento antes do corte. E cada submit reprovado consome uma iteração de
  // tool, então maxToolIterations é o teto de tentativas de correção, não o de
  // chamadas de tool — 3 dava uma chamada de contexto e duas correções.
  // A seção `products` sozinha aceita doze produtos de ~1400 caracteres: o
  // pior caso de uma seção passa de 4096 tokens, e era assim que metade dos
  // runs deste agente terminava sem resposta final.
  budget: { maxToolIterations: 6, maxModelCalls: 8, maxOutputTokens: 8192 },
  requiresSearch: false,
  inputSchema,
  outputSchema: contextOutputSchema as unknown as ZodType<ProposeContextOutput>,

  // Chave por negócio, não por input: as duas propostas de contexto (a seção
  // isolada e o contexto inteiro) gravam na MESMA BusinessContextVersion. Duas
  // em voo ao mesmo tempo custam dois créditos para disputar a mesma versão, e
  // a que chega depois sobrescreve o que a outra propôs.
  concurrencyKey: (input: Input) => `business-context:${input.businessId}`,

  buildTools(input: Input): readonly Tool<never>[] {
    return [createGetBusinessContextTool(input.businessId) as unknown as Tool<never>];
  },

  buildMessages(input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM_BY_SECTION[input.section] },
      {
        role: 'user',
        content: `Fill in the ${input.section} section of my business context, which is stored under "${SECTION_FIELD[input.section]}".`,
      },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    // O enum do inputSchema já recusa, mas o precheck é a rede: é ele que
    // garante que nenhum caminho até a criação do run cobre por uma seção que
    // só devolveria proposta vazia.
    if (!isProposableSection(input.section)) throw new SectionNotProposableError({ section: input.section });

    const business = await prisma.business.findFirst({
      where: { id: input.businessId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!business) throw new NotFoundError('Business not found');
  },

  verifyOutput: verifySection,
};
