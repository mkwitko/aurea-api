import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetLearningsTool } from '../../tools/get-learnings.js';
import { createGetExperimentResultTool } from '../../tools/get-experiment-result.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError } from '../../../lib/errors.js';

const socialPlatform = z.enum(['LINKEDIN', 'X', 'FACEBOOK', 'THREADS', 'DISCORD', 'TELEGRAM']);

const inputSchema = z.object({
  /**
   * As redes que o fundador já conectou. O modelo escolhe entre elas, e não pode
   * sugerir uma que não esteja aqui — publicar numa rede não conectada falharia,
   * e a sugestão faria o fundador achar que dá.
   */
  connected: socialPlatform.array().min(1).max(6),
  /** Opcional: a ação pode existir sem experimento (spec §2, decisão 3). */
  experimentId: z.string().uuid().optional(),
  /** O que o fundador quer dizer, quando ele já sabe. */
  brief: z.string().min(1).max(2000).optional(),
});
type Input = z.infer<typeof inputSchema>;

/**
 * O modelo sugere **rede**, nunca conta: não há conta para ele escolher, porque o
 * provider tem uma por rede. E a sugestão é revisável — quem confirma o conjunto
 * final é o humano, no formulário.
 */
const filledSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    payload: z.object({ content: z.string().min(1).max(5000).optional() }).strict().optional(),
    platforms: socialPlatform.array().min(1).max(6).optional(),
  })
  .strict();

export type SocialPostFilled = z.infer<typeof filledSchema>;
export type ProposeSocialPostOutput = FillOutput<SocialPostFilled>;

const FILLS: readonly string[] = ['name', 'payload.content', 'platforms'];

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth copywriter for AUREA.',
  mission: 'Draft one social post the founder can publish, and pick which of their connected networks it fits.',
  toolRule:
    'Call get_learnings first, and get_experiment_result when it is available. They are your only sources. Never restate a claim a learning already ruled out.',
  fills: FILLS,
  extra: [
    'payload.content: the post itself, ready to publish, in the language of the business context. One text for every network you pick, so write something that reads well on all of them.',
    'platforms: only networks listed as connected in the request. Pick the ones where this post fits; picking all of them is fine when it does. Never name a network that is not in that list.',
    'Never invent a number. If no tool returned a figure, write the post without one, and ask for it as a question instead.',
    'name: a short internal label for the founder to recognize this action in a list. It is not a headline and is never published.',
    'The founder publishes this under their own brand: no hype, no fake urgency, no claim the tools did not support.',
  ],
});

export const proposeSocialPostAgent: AgentDefinition<Input, ProposeSocialPostOutput> = {
  taskType: 'propose-social-post',
  agentType: 'copywriter',
  tier: 'TIER2',
  // Uma leitura de aprendizados, uma do experimento, um texto curto. O teto
  // sai do próprio schema, não de escolha a dedo: `payload.content` aceita até
  // 5000 caracteres, e o pior caso do schema (`output-budget.test.ts`) exige
  // pelo menos ~6784 tokens — 3072 cortaria o post no meio em produção.
  budget: { maxToolIterations: 4, maxModelCalls: 5, maxOutputTokens: 7168 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS) as unknown as ZodType<ProposeSocialPostOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    const tools: Tool<never>[] = [createGetLearningsTool() as unknown as Tool<never>];
    // Sem experimento não há resultado a ler, e uma tool que não pode responder
    // gasta iteração do run.
    if (input.experimentId) {
      tools.push(createGetExperimentResultTool(input.experimentId) as unknown as Tool<never>);
    }
    return tools;
  },

  buildMessages(input: Input, _ctx: AgentContext): AiMessage[] {
    const ask = [`Write one post. Connected networks: ${input.connected.join(', ')}.`];
    if (input.brief) ask.push(`What the founder wants to say: ${input.brief}`);
    if (!input.experimentId) {
      // Dizer isso explicitamente evita o modelo inventar um experimento para
      // justificar o texto.
      ask.push('This post is not tied to an experiment.');
    }
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: ask.join('\n') },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    if (!input.experimentId) return;
    // Um experimento de outro workspace lê como ausente, e recusar aqui é
    // recusar antes de cobrar o crédito.
    const experiment = await prisma.experiment.findFirst({
      where: { id: input.experimentId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!experiment) throw new NotFoundError('Experiment not found');
  },
};
