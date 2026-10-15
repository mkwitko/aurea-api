import type { ZodType } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AiMessage } from '../providers/provider.js';
import type { Tool } from '../tools/tool.js';
import type { Tier } from '../model-router/catalog.js';
import type { TenantContext } from '../../lib/tenant.js';
import { summarizeBusinessContextAgent } from './summarize-business-context.js';
import { proposeStrategiesAgent } from './propose-strategies.js';
import { researchGrowthContextAgent } from './research-growth-context.js';
import { interpretOutcomeAgent } from './interpret-outcome.js';
import { proposeBusinessProfileAgent } from './fill/propose-business-profile.js';
import { proposeBusinessContextAgent } from './fill/propose-business-context.js';
import { proposeContextSectionAgent } from './fill/propose-context-section.js';
import { proposeIcpAgent } from './fill/propose-icp.js';
import { proposeGoalAgent } from './fill/propose-goal.js';
import { proposeHypothesisAgent } from './fill/propose-hypothesis.js';
import { proposeExperimentAgent } from './fill/propose-experiment.js';
import { proposeMetricBindingAgent } from './fill/propose-metric-binding.js';
import { proposeSocialPostAgent } from './fill/propose-social-post.js';

export type AgentContext = { tenant: TenantContext };

// Os tetos de um run nasceram como constantes do runner, dimensionadas para um
// agente de uma tool só. Uma pesquisa precisa de mais espaço, e subir a
// constante compartilhada subiria o pior caso de custo e latência de todos os
// agentes para caber no mais caro.
export type AgentBudget = {
  maxToolIterations?: number;
  maxModelCalls?: number;
  maxOutputTokens?: number;
  // Tempo de parede do run inteiro. Mesma razão dos outros três: o teto global
  // (AI_RUN_TIMEOUT_MS) é dimensionado para um agente de uma tool, e um agente
  // que pesquisa oito vezes antes de responder o estoura — abortado no meio,
  // com o crédito já gasto. Subir o global subiria a janela de detecção de run
  // travado de todos os agentes para caber no mais lento.
  maxRunMs?: number;
};

// Um agente é dado. Quem executa é o runner — por isso nenhum agente pode
// esquecer de validar a própria saída.
export type AgentDefinition<I = unknown, O = unknown> = {
  taskType: string;
  agentType: string;
  tier: Tier;
  budget?: AgentBudget;
  // Declarado como dado para que a criação do run possa recusar antes de
  // cobrar créditos, sem comparar taskType por string.
  requiresSearch?: boolean;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  buildTools(input: I): readonly Tool<never>[];
  buildMessages(input: I, ctx: AgentContext): AiMessage[];
  // requiresSearch recusa por configuração; isto recusa por dado. Declarado no
  // agente, e não como um if por taskType no serviço, pela mesma razão: a
  // criação do run precisa recusar antes de cobrar crédito.
  precheck?(input: I, deps: { prisma: PrismaClient; tenant: TenantContext }): Promise<void>;
  // Escopo de exclusão mútua: dois runs com a mesma chave não podem estar em
  // voo ao mesmo tempo no mesmo workspace. O padrão (taskType + hash do input)
  // só impede o clique duplo no MESMO pedido. Um agente que escreve numa área
  // compartilhada declara uma chave mais larga — as sete seções do contexto de
  // negócio, por exemplo, gravam todas no mesmo BusinessContext, e duas
  // propostas em voo sobre ele disputam a mesma versão.
  concurrencyKey?(input: I): string;
  // Segunda camada de validação, depois que o schema já aceitou a saída: o
  // schema só sabe checar forma (chaves, tamanhos, enum). Isto pode checar
  // conteúdo contra o que as tools realmente devolveram no run — spec §5/§6 do
  // analytics-agent-lite (o "invention guard"). Uma reprovação aqui entra no
  // mesmo laço de correção do guardrail: o runner devolve o feedback como
  // mensagem e deixa o modelo tentar de novo, dentro do orçamento do run.
  // O terceiro parâmetro é o input já validado do run. Sem ele um agente cujo
  // outputSchema é estático não tem como checar a saída contra o que ESTE run
  // pediu — e a checagem tem que estar aqui, dentro do laço de correção, não
  // no cliente: no cliente ela vira filtro silencioso de algo já pago.
  verifyOutput?(
    output: O,
    toolResults: readonly unknown[],
    input: I,
  ): { ok: true } | { ok: false; feedback: string };
  // Efeito colateral do sucesso, sob controle do agente, não do runner:
  // markCompleted só grava `output` em AgentRun.output, e um fundador que quer
  // o resultado no Growth Brain hoje precisa colher cada seção à mão. Um
  // agente que declara isto tem seu output aplicado ao estado canônico (uma
  // nova BusinessContextVersion, por exemplo) DEPOIS de verifyOutput e ANTES
  // de markCompleted — nessa ordem porque uma exceção aqui falha o run pelo
  // mesmo caminho de fail() (markFailed + estorno via policy.onRunFailed): um
  // output que passou a validação de forma e conteúdo mas não pôde ser
  // aplicado ao dado real não é sucesso, mesmo que o modelo tenha acertado.
  // Idempotência é responsabilidade do agente, não do runner: um job do BullMQ
  // pode reprocessar um run já COMPLETED, e é o agente quem sabe como
  // reconhecer sua própria escrita anterior (aqui, por sourceAgentRunId).
  applyOutput?(
    output: O,
    ctx: { prisma: PrismaClient; workspaceId: string; runId: string },
  ): Promise<void>;
};

export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  [summarizeBusinessContextAgent.taskType]: summarizeBusinessContextAgent as AgentDefinition,
  [proposeStrategiesAgent.taskType]: proposeStrategiesAgent as AgentDefinition,
  [researchGrowthContextAgent.taskType]: researchGrowthContextAgent as AgentDefinition,
  [interpretOutcomeAgent.taskType]: interpretOutcomeAgent as AgentDefinition,
  [proposeBusinessProfileAgent.taskType]: proposeBusinessProfileAgent as AgentDefinition,
  [proposeBusinessContextAgent.taskType]: proposeBusinessContextAgent as AgentDefinition,
  [proposeContextSectionAgent.taskType]: proposeContextSectionAgent as AgentDefinition,
  [proposeIcpAgent.taskType]: proposeIcpAgent as AgentDefinition,
  [proposeGoalAgent.taskType]: proposeGoalAgent as AgentDefinition,
  [proposeHypothesisAgent.taskType]: proposeHypothesisAgent as AgentDefinition,
  [proposeExperimentAgent.taskType]: proposeExperimentAgent as AgentDefinition,
  [proposeMetricBindingAgent.taskType]: proposeMetricBindingAgent as AgentDefinition,
  [proposeSocialPostAgent.taskType]: proposeSocialPostAgent as AgentDefinition,
};

export function getAgent(taskType: string): AgentDefinition | undefined {
  return AGENT_REGISTRY[taskType];
}
