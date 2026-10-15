import { z } from 'zod';
import type { AnswerTypeByFill } from './contract.js';

/**
 * A classificação em três classes, por seção. Não é taxonomia de documentação:
 * é a decisão que o agente toma por campo e o estado que o formulário desenha.
 *
 * - **Pesquisável** — o modelo preenche, do site e da web. Entra em `filled`.
 * - **Só o fundador sabe** — vira pergunta. Entra em `CONTEXT_FILLS`.
 * - **Derivado** — uma fórmula calcula. Não entra em nenhum dos dois.
 *
 * `projects` e `campaigns` ficam de fora das duas listas: são registro interno
 * inteiro — nome, orçamento, dono e objetivos de um projeto não existem em
 * lugar nenhum fora da empresa.
 */
export const PROPOSABLE_SECTIONS = [
  'company',
  'products',
  'competitive',
  'market',
  'constraints',
  'performance',
  'activities',
] as const;

export type ProposableSection = (typeof PROPOSABLE_SECTIONS)[number];

export function isProposableSection(value: string): value is ProposableSection {
  return (PROPOSABLE_SECTIONS as readonly string[]).includes(value);
}

/**
 * Espelha o SECTION_FIELD de update-section.service.ts, sem `projects` e
 * `campaigns`. Os caminhos de `fills` usam o nome do CAMPO (companyProfile),
 * não o da seção (company), porque é nesse nome que o formulário do front
 * grava — o painel chama setValue com este caminho tal e qual.
 */
export const SECTION_FIELD = {
  company: 'companyProfile',
  products: 'products',
  competitive: 'competitiveLandscape',
  market: 'marketContext',
  constraints: 'constraints',
  performance: 'currentPerformance',
  activities: 'currentActivities',
} as const satisfies Record<ProposableSection, string>;

export type ContextField = (typeof SECTION_FIELD)[ProposableSection];

// ───────────────────────── filled: o que o modelo pesquisa ─────────────────────────

// documentUrls fica fora: são uploads. O agente nem propõe uma url que o
// usuário não deu, nem pede uma numa caixa de texto.
const companyFilled = z
  .object({
    logoUrl: z.string().url().max(500).optional(),
    foundedYear: z.number().int().min(1800).max(2100).optional(),
    mission: z.string().min(1).max(600).optional(),
    vision: z.string().min(1).max(600).optional(),
    values: z.array(z.string().min(1).max(80)).max(8).optional(),
    brandVoice: z.string().min(1).max(400).optional(),
    fundingStage: z
      .enum(['bootstrapped', 'pre-seed', 'seed', 'series-a', 'series-b', 'series-c+', 'public'])
      .optional(),
    headquarters: z.string().min(1).max(160).optional(),
    employeeCount: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict();

// `id` é gerado pelo cliente antes do setValue, então nem aparece aqui.
const productFilled = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(600),
    targetAudience: z.string().min(1).max(300).optional(),
    differentiator: z.string().min(1).max(300).optional(),
    pricingModel: z
      .enum(['free', 'freemium', 'subscription', 'one-time', 'usage-based', 'custom'])
      .optional(),
    pricePoint: z.string().min(1).max(120).optional(),
    status: z.enum(['active', 'beta', 'planned', 'sunset']).optional(),
  })
  .strict();

const competitorFilled = z
  .object({
    name: z.string().min(1).max(160),
    url: z.string().url().max(500).optional(),
    strengths: z.array(z.string().min(1).max(200)).max(4).optional(),
    weaknesses: z.array(z.string().min(1).max(200)).max(4).optional(),
    pricing: z.string().min(1).max(200).optional(),
    positioning: z.string().min(1).max(300).optional(),
    marketShare: z.enum(['dominant', 'major', 'emerging', 'niche']).optional(),
  })
  .strict();

const competitiveFilled = z
  .object({
    competitors: z.array(competitorFilled).max(8).optional(),
    ourDifferentiator: z.string().min(1).max(600).optional(),
    marketPosition: z.enum(['leader', 'challenger', 'follower', 'niche']).optional(),
    competitiveAdvantages: z.array(z.string().min(1).max(200)).max(6).optional(),
    threatsFromCompetitors: z.array(z.string().min(1).max(200)).max(6).optional(),
  })
  .strict();

// tam sai de relatório público; sam e som dependem do alcance da própria
// empresa, então são pergunta, não pesquisa.
const marketFilled = z
  .object({
    tam: z.number().positive().optional(),
    marketGrowthRate: z.number().optional(),
    trends: z.array(z.string().min(1).max(200)).max(6).optional(),
    opportunities: z.array(z.string().min(1).max(200)).max(6).optional(),
    threats: z.array(z.string().min(1).max(200)).max(6).optional(),
    maturity: z.enum(['emerging', 'growth', 'mature', 'declining']).optional(),
  })
  .strict();

// Só o que sai de setor e geografia. Orçamento, time e urgência são do
// fundador.
const constraintsFilled = z
  .object({
    regulatoryConstraints: z.array(z.string().min(1).max(200)).max(6).optional(),
  })
  .strict();

const activitiesFilled = z
  .object({
    activeChannels: z.array(z.string().min(1).max(80)).max(10).optional(),
    partnerships: z.array(z.string().min(1).max(160)).max(8).optional(),
    paidAdvertising: z
      .object({ platforms: z.array(z.string().min(1).max(80)).max(8).optional() })
      .strict()
      .optional(),
  })
  .strict();

/**
 * `currentPerformance` não tem ramo aqui, e isso é o desenho: dos seus doze
 * campos, quatro são derivados e oito só o fundador sabe. Nenhum é
 * pesquisável. Deixar a chave de fora torna "o modelo nunca preenche uma
 * métrica de dinheiro" estrutural, em vez de uma regra que alguém precisa
 * lembrar de conferir.
 */
export const contextFilledSchema = z
  .object({
    companyProfile: companyFilled.optional(),
    products: z.array(productFilled).max(12).optional(),
    competitiveLandscape: competitiveFilled.optional(),
    marketContext: marketFilled.optional(),
    constraints: constraintsFilled.optional(),
    currentActivities: activitiesFilled.optional(),
  })
  .strict();

// ───────────────────────── fills: o que o modelo pergunta ─────────────────────────

/**
 * Campos só-do-fundador que uma pergunta de valor único consegue preencher.
 *
 * Ficam de fora, e continuam sendo só-do-fundador — apenas não perguntáveis
 * assim: `constraints.technicalCapabilities`, `constraints.limitations` e
 * `currentPerformance.channels`. As duas primeiras são listas livres, a
 * terceira é uma lista de objetos; nenhuma cabe numa resposta única, e o
 * fundador as digita no próprio formulário.
 *
 * Nenhum campo derivado aparece aqui. `arr`, `cac`, `ltv` e `ltvCacRatio` são
 * da fórmula.
 */
export const CONTEXT_FILLS = [
  'marketContext.sam',
  'marketContext.som',
  'constraints.monthlyGrowthBudget',
  'constraints.teamSize',
  'constraints.growthTeamSize',
  'constraints.urgency',
  'currentPerformance.mrr',
  'currentPerformance.totalCustomers',
  'currentPerformance.activeCustomers',
  'currentPerformance.churnRate',
  'currentPerformance.monthlySignups',
  'currentPerformance.conversionRate',
  'currentPerformance.timeToConvert',
  'currentPerformance.baselineDate',
  'currentActivities.contentProduction.blogPostsPerMonth',
  'currentActivities.contentProduction.socialPostsPerWeek',
  'currentActivities.contentProduction.emailCampaignsPerMonth',
  'currentActivities.paidAdvertising.monthlySpend',
] as const;

/**
 * O tipo de resposta que cada destino de `CONTEXT_FILLS` aceita — o que o
 * campo do formulário do outro lado é capaz de guardar.
 *
 * `constraints.urgency` é o único enum (o painel monta um select com as
 * `choices` que o modelo manda). `currentPerformance.baselineDate` é o único
 * texto: data viaja como ISO. Todo o resto é número, e a distinção entre
 * `currency`, `percent` e `count` existe porque muda o campo que o fundador vê
 * — moeda com máscara de milhar, percentual sem.
 */
export const CONTEXT_FILL_ANSWER_TYPES: AnswerTypeByFill = {
  'marketContext.sam': ['currency'],
  'marketContext.som': ['currency'],
  'constraints.monthlyGrowthBudget': ['currency'],
  'constraints.teamSize': ['count'],
  'constraints.growthTeamSize': ['count'],
  'constraints.urgency': ['choice'],
  'currentPerformance.mrr': ['currency'],
  'currentPerformance.totalCustomers': ['count'],
  'currentPerformance.activeCustomers': ['count'],
  'currentPerformance.churnRate': ['percent'],
  'currentPerformance.monthlySignups': ['count'],
  'currentPerformance.conversionRate': ['percent'],
  'currentPerformance.timeToConvert': ['number', 'count'],
  'currentPerformance.baselineDate': ['text'],
  'currentActivities.contentProduction.blogPostsPerMonth': ['count'],
  'currentActivities.contentProduction.socialPostsPerWeek': ['count'],
  'currentActivities.contentProduction.emailCampaignsPerMonth': ['count'],
  'currentActivities.paidAdvertising.monthlySpend': ['currency'],
};

/**
 * `CONTEXT_FILLS` recortado por seção, pela mesma regra de prefixo que o
 * `verifySection` de propose-context-section aplica na volta.
 *
 * Um run de uma seção só recebia a lista inteira, então o modelo escolhia um
 * `fills` legal pelo enum e ilegal para a seção, e cada tentativa morria no
 * verify até o orçamento acabar. Pior nas três seções sem nenhuma entrada
 * própria: ali não existe pergunta possível, e o modelo só descobria isso
 * gastando chamadas. Derivar as duas pontas da mesma regra é o que impede o
 * prompt de prometer o que o verify recusa.
 */
export const SECTION_FILLS: Record<ProposableSection, readonly string[]> =
  PROPOSABLE_SECTIONS.reduce(
    (acc, section) => {
      acc[section] = CONTEXT_FILLS.filter((path) => path.startsWith(`${SECTION_FIELD[section]}.`));
      return acc;
    },
    {} as Record<ProposableSection, readonly string[]>,
  );
