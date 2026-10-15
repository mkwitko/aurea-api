import type { PrismaClient } from '@prisma/client';
import { getAgent } from '../agents/registry.js';
import { getModelForTier, nextTier, type Tier } from '../model-router/router.js';
import { parseToolArgs, toToolSpec, type Tool, type ToolContext } from '../tools/tool.js';
import { validateArgs, validateOutput } from './guardrail.js';
import { buildSubmitToolSpec, SUBMIT_TOOL_NAME } from './submit-answer.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, OUTPUT_TOKEN_CEILING } from './output-budget.js';
import { addUsage, computeCost, costBreakdown, emptyUsage, type UsageTotals } from './cost.js';
import type { AgentRunRepository } from '../agent-run/agent-run.repository.js';
import type { AiPolicy, ProviderCredentials } from '../policy.js';
import type { AiMessage, AiProvider, AiUsage } from '../providers/provider.js';
import type { TenantContext } from '../../lib/tenant.js';
import { env } from '../../config/env.js';
import { publishRunEvent } from '../events/run-events.js';
import { startRunTrace, type RunSpan, type RunSpanData } from '../../integrations/tracing/index.js';

export type RunnerDeps = {
  prisma: PrismaClient;
  repo: AgentRunRepository;
  policy: AiPolicy;
  createProvider(providerName: string, credentials: ProviderCredentials): AiProvider;
  logger: { info(obj: object, msg: string): void; error(obj: object, msg: string): void };
};

const MAX_TOOL_ITERATIONS = 5;
/**
 * Quantas vezes uma resposta cortada pelo teto de saída pode comprar uma
 * iteração e uma chamada de modelo a mais.
 *
 * Truncagem é limite NOSSO, não erro do modelo: o teto inicial é escolhido
 * aqui, e a tentativa que o guardrail pede em seguida precisa caber em algum
 * orçamento. Sem este crédito, um teto pequeno consome as iterações do run e o
 * fundador termina com FAILED e estorno — foi o run ebf8e706, cortado três
 * vezes num agente que tinha exatamente 3 iterações. Três créditos é quanto o
 * dobro precisa para ir de 2048 a 16384.
 */
const MAX_GROWTH_GRANTS = 3;
// Teto de chamadas ao modelo para o run INTEIRO (não por tentativa de guardrail).
// modelCalls vem do run persistido, então uma retentativa de job (BullMQ) que já
// gastou parte do orçamento não ganha um teto novo.
const MAX_MODEL_CALLS = 3;

async function resolveTenant(deps: RunnerDeps, run: { workspaceId: string; requestedBy: string | null }): Promise<TenantContext> {
  const membership = await deps.prisma.membership.findFirst({
    where: { workspaceId: run.workspaceId, ...(run.requestedBy ? { userId: run.requestedBy } : {}) },
  });
  return {
    userId: run.requestedBy ?? 'system',
    organizationId: membership?.organizationId ?? '',
    workspaceId: run.workspaceId,
    role: membership?.role ?? 'MEMBER',
  };
}

export async function executeAgentRun(deps: RunnerDeps, agentRunId: string): Promise<void> {
  const run = await deps.repo.findById(agentRunId);
  if (!run) return;
  if (run.status === 'COMPLETED' || run.status === 'CANCELLED') return;

  // Uso acumulado POR TIER: a escalada troca de modelo no meio do run, e cobrar
  // os tokens do flash a preço de pro (ou o contrário) falsifica a margem.
  const usageByTier = new Map<Tier, UsageTotals>();

  function recordUsage(usedTier: Tier, usage: AiUsage): void {
    const previous = usageByTier.get(usedTier) ?? emptyUsage();
    usageByTier.set(usedTier, addUsage(previous, {
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
    }));
  }

  function totalUsage(): UsageTotals {
    let total = emptyUsage();
    for (const partial of usageByTier.values()) total = addUsage(total, partial);
    return total;
  }

  function totalCost(): number {
    let cost = 0;
    for (const [usedTier, partial] of usageByTier) {
      cost += computeCost(getModelForTier(usedTier), partial);
    }
    return cost;
  }

  let modelCalls = run.modelCalls;
  let tier = (run.tier ?? 'TIER1') as Tier;
  let entry = getModelForTier(tier);

  // Uma trace por run, nomeada pelo taskType. Sem Langfuse configurado isto é
  // um no-op silencioso (ver integrations/tracing) — nunca é pré-condição
  // para o run.
  const trace = await startRunTrace(
    run.taskType,
    {
      agentRunId,
      workspaceId: run.workspaceId,
      userId: run.requestedBy ?? undefined,
      tags: [run.taskType, run.agentType, tier, entry.provider],
    },
    { model: entry.modelId },
  );

  // Mesmo raciocínio do publish de eventos SSE logo abaixo: uma trace é
  // visibilidade, nunca pode derrubar o run que ela só observa. Toda
  // interação com `trace`/`RunSpan` passa por um destes quatro helpers — nem
  // a implementação real (que já se protege internamente, ver
  // integrations/tracing/run-trace.ts) nem um dublê de teste que jogue
  // exceção de propósito podem escapar daqui.
  const noopRunSpan: RunSpan = {
    child: () => noopRunSpan,
    update() {},
    end() {},
  };
  const traceSpan = (name: string, data?: RunSpanData) => {
    try {
      trace.span(name, data);
    } catch {
      // idem
    }
  };
  const startSpan = (name: string, data?: RunSpanData): RunSpan => {
    try {
      return trace.startSpan(name, data);
    } catch {
      return noopRunSpan;
    }
  };
  const childSpan = (span: RunSpan, name: string, data?: RunSpanData): RunSpan => {
    try {
      return span.child(name, data);
    } catch {
      return noopRunSpan;
    }
  };
  const endSpan = (span: RunSpan, data?: RunSpanData): void => {
    try {
      span.end(data);
    } catch {
      // idem
    }
  };

  // Resolvido antes do primeiro `fail`: a policy precisa do tenant para saber
  // de qual workspace estornar, e há caminhos de falha antes da autorização.
  const tenant = await resolveTenant(deps, run);

  const fail = async (error: string) => {
    await deps.repo.markFailed(agentRunId, {
      error,
      model: entry.modelId,
      provider: entry.provider,
      tier,
      ...totalUsage(),
      estimatedCost: totalCost(),
      modelCalls,
    });
    await deps.policy.onRunFailed(tenant, agentRunId);
    try {
      trace.fail(error);
    } catch {
      // idem
    }
    try {
      // Um evento perdido custa, no pior caso, o intervalo do poll (30s) — o
      // socket é latência, não a fonte de verdade. Nunca deixe publicar
      // derrubar um run que já terminou.
      await publishRunEvent(tenant.workspaceId, { runId: agentRunId, status: 'FAILED' });
    } catch {
      // idem
    }
  };

  const agent = getAgent(run.taskType);
  if (!agent) {
    await fail(`unknown task type: ${run.taskType}`);
    return;
  }

  // Ausência de campo cai na constante do módulo, então os agentes que não
  // declaram budget se comportam exatamente como antes desta mudança.
  // Não são const porque a truncagem os aumenta (ver MAX_GROWTH_GRANTS): o
  // orçamento que o agente declarou é para o trabalho dele, não para pagar um
  // teto de saída que nós escolhemos apertado.
  let maxToolIterations = agent.budget?.maxToolIterations ?? MAX_TOOL_ITERATIONS;
  let maxModelCalls = agent.budget?.maxModelCalls ?? MAX_MODEL_CALLS;
  let growthGrants = 0;
  // Não é const: uma resposta cortada pelo teto cresce o teto da próxima
  // chamada, dentro do run, até OUTPUT_TOKEN_CEILING.
  let outputTokens = agent.budget?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxRunMs = agent.budget?.maxRunMs ?? env.AI_RUN_TIMEOUT_MS;

  const parsedInput = agent.inputSchema.safeParse(run.input);
  if (!parsedInput.success) {
    await fail(`invalid run input: ${parsedInput.error.issues.map((i) => i.message).join('; ')}`);
    return;
  }

  const authorization = await deps.policy.authorizeRun(tenant, {
    taskType: run.taskType,
    agentRunId,
    provider: entry.provider,
  });
  traceSpan('authorize', {
    input: { taskType: run.taskType, provider: entry.provider },
    output: { allowed: authorization.allowed, reason: authorization.allowed ? null : authorization.reason },
    level: authorization.allowed ? 'DEFAULT' : 'WARNING',
  });
  if (!authorization.allowed) {
    await fail(`run not authorized: ${authorization.reason}`);
    return;
  }

  // count === 0: alguém fechou o run entre a leitura lá em cima e agora — em
  // geral um cancelamento. Seguir daqui gastaria modelo por um resultado que
  // ninguém mais espera.
  const started = await deps.repo.markRunning(agentRunId);
  if (started.count === 0) return;

  let provider: AiProvider;
  try {
    const credentials = await deps.policy.resolveProviderCredentials(tenant, entry.provider);
    provider = deps.createProvider(entry.provider, credentials);
  } catch (error) {
    await fail(error instanceof Error ? error.message : 'could not resolve provider credentials');
    return;
  }

  let agentTools: readonly Tool<never>[];
  let tools: ReturnType<typeof toToolSpec>[];
  let messages: AiMessage[];
  try {
    // buildTools pode chamar código que depende de configuração externa (ex.:
    // createSearchProviderFromEnv, que lança se a busca não estiver
    // configurada). Sem este try, uma exceção aqui escaparia de
    // executeAgentRun inteiro: markFailed nunca rodaria, onRunFailed nunca
    // estornaria o crédito, e o run ficaria preso em RUNNING para sempre —
    // mesmo padrão do bloco de credenciais do provider logo acima.
    agentTools = agent.buildTools(parsedInput.data);
    tools = [...agentTools.map(toToolSpec), buildSubmitToolSpec(agent.outputSchema)];
    messages = [...agent.buildMessages(parsedInput.data, { tenant })];
  } catch (error) {
    await fail(error instanceof Error ? error.message : 'could not build agent tools or messages');
    return;
  }

  const controller = new AbortController();
  const runTimeout = setTimeout(() => controller.abort(), maxRunMs);

  try {
    const toolsByName = new Map<string, Tool<never>>(agentTools.map((tool) => [tool.name, tool]));
    const toolCtx: ToolContext = { tenant, prisma: deps.prisma, signal: controller.signal };

    // Resultados de tool bem-sucedidos, acumulados por todo o run (todas as
    // tentativas de guardrail incluídas). Só isto dá a um agente base para
    // conferir o próprio texto contra dado real — ver AgentDefinition.verifyOutput.
    const toolResults: unknown[] = [];

    // Escopo da tentativa (não do run inteiro), mas declarado aqui — antes de
    // `runToolLoop` — para que o closure do laço de tools possa atribuir
    // diretamente na rejeição de um submit_answer malformado. Uma correção
    // dessas acontece dentro do MESMO runToolLoop, sem nunca voltar pro laço de
    // tentativa externo; se o orçamento de chamadas acabar no meio disso, esta
    // é a única variável que carrega o motivo, e o fail() no ramo de 'budget'
    // depende dela.
    let lastFeedback: string | null = null;

    // Devolve o texto final do modelo, ou o motivo de ter parado sem resposta:
    // 'budget' quando o orçamento de chamadas do run inteiro (maxModelCalls)
    // acabou no meio do laço, 'iterations' quando o modelo ficou preso pedindo
    // tools. Os dois motivos viram mensagens de erro diferentes.
    type LoopStop =
      | { kind: 'text'; text: string }
      | { kind: 'submit'; value: unknown }
      | { kind: 'budget' }
      | { kind: 'iterations' }
      | { kind: 'cancelled' };

    const runToolLoop = async (): Promise<LoopStop> => {
      for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
        if (modelCalls >= maxModelCalls) return { kind: 'budget' };

        // Cancelamento é cooperativo: quem marca CANCELLED e estorna é o
        // endpoint de cancelar, porque o job pode já estar em execução e o
        // BullMQ não interrompe um job ativo. O que resta aqui é parar de
        // gastar modelo — e é entre chamadas que isso custa mais barato.
        const live = await deps.repo.findById(agentRunId);
        if (live?.status === 'CANCELLED') return { kind: 'cancelled' };

        const modelSpan = startSpan('model-call', {
          kind: 'generation',
          model: entry.modelId,
          input: messages,
          metadata: { tier, iteration },
        });

        let completion;
        try {
          completion = await provider.complete({
            modelId: entry.modelId,
            messages,
            tools: tools.length ? tools : undefined,
            // A tool de submit já impõe a forma. `json_object` junto dela empurra
            // o modelo a escrever o objeto como texto e ignorar a tool — os dois
            // mecanismos disputam a mesma saída.
            jsonMode: false,
            maxTokens: outputTokens,
            signal: controller.signal,
          });
        } catch (error) {
          endSpan(modelSpan, {
            output: { error: error instanceof Error ? error.message : 'provider call failed' },
            level: 'ERROR',
          });
          throw error;
        }

        modelCalls += 1;
        // Sinal de vida para o reaper: um run que ainda conversa com o modelo
        // está lento, não morto, e não pode ser fechado por baixo dele.
        // Best-effort de propósito — falhar aqui não pode matar o run.
        await deps.repo.touchHeartbeat(agentRunId).catch(() => {});
        recordUsage(tier, completion.usage);
        endSpan(modelSpan, {
          output: { text: completion.text, toolCalls: completion.toolCalls, finishReason: completion.finishReason },
          usageDetails: {
            input: completion.usage.inputTokens,
            output: completion.usage.outputTokens,
            cache_read_input_tokens: completion.usage.cachedInputTokens,
          },
          // O custo vai explícito: o Langfuse não conhece o preço de
          // deepseek-v4-*, e um custo inferido que discorda do que a carteira
          // do workspace pagou é pior que custo nenhum.
          costDetails: costBreakdown(entry, {
            inputTokens: completion.usage.inputTokens,
            cachedInputTokens: completion.usage.cachedInputTokens,
            outputTokens: completion.usage.outputTokens,
          }),
        });

        // Corte pelo teto de saída não é erro de conteúdo, e é o único que o
        // pedido de encurtar do guardrail não resolve sozinho: o teto é o mesmo
        // na tentativa seguinte, então a resposta é cortada no mesmo lugar até o
        // orçamento acabar. Quem tem que crescer é o espaço. Vale para os dois
        // caminhos — argumento de submit_answer cortado no meio e texto cortado
        // no meio do JSON — porque a causa é a mesma.
        if (completion.finishReason === 'length' && outputTokens < OUTPUT_TOKEN_CEILING) {
          const grown = Math.min(outputTokens * 2, OUTPUT_TOKEN_CEILING);
          // Junto com o espaço, o direito de usá-lo: crescer o teto e não dar
          // iteração para a nova tentativa é a mesma falha com outro nome.
          const granted = growthGrants < MAX_GROWTH_GRANTS;
          if (granted) {
            growthGrants += 1;
            maxToolIterations += 1;
            maxModelCalls += 1;
          }
          traceSpan('grow-output-ceiling', {
            input: { from: outputTokens },
            output: { to: grown, grantedRetry: granted },
            level: 'WARNING',
            metadata: { iteration, growthGrants, maxToolIterations, maxModelCalls },
          });
          outputTokens = grown;
        }

        if (!completion.toolCalls.length) return { kind: 'text', text: completion.text ?? '' };

        messages.push({ role: 'assistant', content: completion.text, toolCalls: completion.toolCalls });

        for (const call of completion.toolCalls) {
          if (call.name === SUBMIT_TOOL_NAME) {
            const submitted = validateArgs(agent.outputSchema, call.args, {
              truncated: completion.finishReason === 'length',
            });
            if (submitted.ok) {
              // O provider exige uma resposta de tool para cada tool_call antes
              // da próxima mensagem não-tool — inclusive quando a tool é
              // submit_answer e o run está prestes a terminar. Sem isto, se
              // verifyOutput reprovar o conteúdo lá na tentativa externa, a
              // próxima chamada ao provider carrega um tool_calls sem resposta
              // seguido de mensagem de usuário, e todo backend OpenAI-compatible
              // devolve 400.
              messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ received: true }) });
              return { kind: 'submit', value: submitted.value };
            }

            // A correção acontece dentro do mesmo laço de tools: o modelo vê o
            // erro como resultado da tool e chama de novo. É uma chamada de
            // modelo, contra a tentativa inteira (com escalada de tier) que a
            // reprovação de guardrail no texto custa.
            lastFeedback = submitted.feedback;
            // submit_answer não tem tool.execute — não há nada a cronometrar,
            // mas uma submissão rejeitada é exatamente a causa invisível de um
            // run que fica repetindo tentativas, então ela ainda entra na trace.
            endSpan(
              childSpan(modelSpan, 'tool-call', {
                kind: 'tool',
                input: call.args,
                metadata: { name: SUBMIT_TOOL_NAME },
              }),
              { output: { error: submitted.feedback }, level: 'WARNING', metadata: { name: SUBMIT_TOOL_NAME, ok: false } },
            );
            messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: submitted.feedback }) });
            continue;
          }

          const startedAt = new Date();
          const started = Date.now();
          const tool = toolsByName.get(call.name);

          if (!tool) {
            const message = `unknown tool: ${call.name}`;
            const durationMs = Date.now() - started;
            await deps.repo.recordToolCall({
              agentRunId, name: call.name, args: call.args as object, result: null,
              ok: false, error: message, durationMs, startedAt,
            });
            endSpan(
              childSpan(modelSpan, 'tool-call', { kind: 'tool', input: call.args, metadata: { name: call.name } }),
              { output: { error: message }, level: 'WARNING', metadata: { name: call.name, ok: false, durationMs } },
            );
            messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: message }) });
            continue;
          }

          const args = parseToolArgs(tool, call.args);
          if (!args.ok) {
            const durationMs = Date.now() - started;
            await deps.repo.recordToolCall({
              agentRunId, name: call.name, args: call.args as object, result: null,
              ok: false, error: args.feedback, durationMs, startedAt,
            });
            endSpan(
              childSpan(modelSpan, 'tool-call', { kind: 'tool', input: call.args, metadata: { name: call.name } }),
              { output: { error: args.feedback }, level: 'WARNING', metadata: { name: call.name, ok: false, durationMs } },
            );
            messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: args.feedback }) });
            continue;
          }

          const toolSpan = childSpan(modelSpan, 'tool-call', {
            kind: 'tool',
            input: call.args,
            metadata: { name: call.name },
          });
          try {
            const result = await tool.execute(args.value, toolCtx);
            toolResults.push(result);
            const durationMs = Date.now() - started;
            await deps.repo.recordToolCall({
              agentRunId, name: call.name, args: call.args as object, result: result as object,
              ok: true, error: null, durationMs, startedAt,
            });
            endSpan(toolSpan, { output: result, metadata: { name: call.name, ok: true, durationMs } });
            messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'tool execution failed';
            const durationMs = Date.now() - started;
            await deps.repo.recordToolCall({
              agentRunId, name: call.name, args: call.args as object, result: null,
              ok: false, error: message, durationMs, startedAt,
            });
            endSpan(toolSpan, { output: { error: message }, level: 'ERROR', metadata: { name: call.name, ok: false, durationMs } });
            messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: message }) });
          }
        }
      }
      return { kind: 'iterations' };
    };

    // Efeitos colaterais de sucesso, num só lugar: crédito, trace e SSE não
    // podem duplicar entre o caminho de tool (submit_answer) e o de texto.
    const complete = async (value: unknown): Promise<void> => {
      await deps.repo.markCompleted(agentRunId, {
        output: value as object,
        model: entry.modelId,
        provider: entry.provider,
        tier,
        ...totalUsage(),
        estimatedCost: totalCost(),
        modelCalls,
      });
      deps.logger.info(
        {
          agentRunId,
          taskType: run.taskType,
          workspaceId: run.workspaceId,
          model: entry.modelId,
          tier,
          modelCalls,
          ...totalUsage(),
          estimatedCost: totalCost(),
        },
        'agent run completed',
      );
      try {
        // O total do run vai junto com o encerramento da trace, para que o
        // cabeçalho da trace no Langfuse mostre o preço real cobrado — o
        // mesmo número que foi debitado da carteira do workspace.
        trace.end({ output: value, costDetails: { total: totalCost() } });
      } catch {
        // idem
      }
      try {
        // Mesmo raciocínio do fail(): um evento perdido custa no máximo o
        // próximo poll, então publicar nunca pode derrubar um run que já
        // terminou com sucesso.
        await publishRunEvent(tenant.workspaceId, { runId: agentRunId, status: 'COMPLETED' });
      } catch {
        // idem
      }
    };

    let attempt = 0;

    // O schema só sabe checar forma (validateArgs / validateOutput, já
    // rodados antes disto). verifyOutput checa conteúdo contra o que as tools
    // de fato devolveram — a mesma reprovação de um guardrail de forma, só
    // que de conteúdo, e entra no mesmo laço de correção. Compartilhado pelos
    // dois caminhos (submit_answer e texto) para que crédito, trace e SSE de
    // sucesso, e o traceSpan de rejeição, nunca divirjam entre eles.
    //
    // Devolve a verificação (em vez de só bool) para que `lastFeedback` seja
    // atribuído no call site: o TS não consegue provar `lastFeedback` não-nulo
    // no `messages.push` de baixo se a atribuição acontecer dentro desta
    // função — closures são opacas para o narrowing de controle de fluxo do
    // escopo de fora.
    //
    // `retry: false` distingue uma reprovação de guardrail (a próxima
    // tentativa PODE consertar, então o modelo recebe `feedback` como
    // mensagem) de uma falha de applyOutput (não pode: o run já foi marcado
    // FAILED por `fail()` dentro desta função, e insistir só gastaria mais
    // modelo por um resultado que ninguém vai gravar duas vezes).
    const verifyAndComplete = async (
      value: unknown,
    ): Promise<{ ok: true } | { ok: false; retry: true; feedback: string } | { ok: false; retry: false }> => {
      const verification = agent.verifyOutput?.(value, toolResults, parsedInput.data) ?? { ok: true as const };
      if (!verification.ok) {
        traceSpan('verify-output-rejection', { input: value, output: verification.feedback, level: 'WARNING', metadata: { attempt } });
        return { ok: false, retry: true, feedback: verification.feedback };
      }

      if (agent.applyOutput) {
        try {
          await agent.applyOutput(value, { prisma: deps.prisma, workspaceId: run.workspaceId, runId: agentRunId });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'could not apply agent output';
          traceSpan('apply-output-failed', { input: value, output: message, level: 'ERROR', metadata: { attempt } });
          await fail(message);
          return { ok: false, retry: false };
        }
      }

      await complete(value);
      return { ok: true };
    };

    while (modelCalls < maxModelCalls) {
      attempt += 1;

      const stop = await runToolLoop();

      if (stop.kind === 'cancelled') {
        // A linha já está CANCELLED e o estorno já saiu pelo endpoint. Marcar
        // FAILED aqui só sobrescreveria o motivo real com um erro que não houve.
        traceSpan('cancelled', { output: { modelCalls }, level: 'WARNING' });
        deps.logger.info({ agentRunId, modelCalls }, 'run cancelled by the user');
        return;
      }

      if (stop.kind === 'submit') {
        const verification = await verifyAndComplete(stop.value);
        if (verification.ok) return;
        if (!verification.retry) return;
        lastFeedback = verification.feedback;
      } else if (stop.kind === 'text') {
        const validated = validateOutput(agent.outputSchema, stop.text);
        if (validated.ok) {
          const verification = await verifyAndComplete(validated.value);
          if (verification.ok) return;
          if (!verification.retry) return;
          lastFeedback = verification.feedback;
        } else {
          lastFeedback = validated.feedback;
          traceSpan('guardrail-rejection', { input: stop.text, output: lastFeedback, level: 'WARNING', metadata: { attempt } });
        }
      } else {
        // Sem orçamento no meio do laço de tools: se já houve reprovação de
        // guardrail, o erro útil é a última reprovação; senão o run só ficou
        // chamando tools até o dinheiro acabar.
        await fail(
          stop.kind === 'iterations'
            ? `tool iteration cap reached (${maxToolIterations}) without a final answer`
            : (lastFeedback ?? `model call budget exhausted (${maxModelCalls}) without a final answer`),
        );
        return;
      }

      if (modelCalls >= maxModelCalls) break;

      // 1ª falha de guardrail: repair no mesmo tier, o modelo vê seu próprio
      // JSON inválido e o erro de validação. 2ª falha: escalada de tier — no
      // topo da escada, nextTier devolve null e a tentativa restante vira
      // repair no mesmo modelo em vez de escalar.
      if (attempt >= 2) {
        const escalated = nextTier(tier);
        if (escalated) {
          const previousTier = tier;
          tier = escalated;
          entry = getModelForTier(tier);
          traceSpan('escalate-tier', {
            input: { from: previousTier, feedback: lastFeedback },
            output: { to: tier, model: entry.modelId },
            level: 'WARNING',
          });
        }
      }

      messages.push({ role: 'user', content: lastFeedback });
    }

    await fail(lastFeedback ?? `model call budget exhausted (${maxModelCalls}) without a final answer`);
  } catch (error) {
    await fail(error instanceof Error ? error.message : 'run failed');
  } finally {
    clearTimeout(runTimeout);
  }
}
