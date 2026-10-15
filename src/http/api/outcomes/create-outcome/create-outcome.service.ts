import type { Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { interpretOutcomeAgent } from '../../../../ai/agents/interpret-outcome.js';
import type { TenantContext } from '../../../../lib/tenant.js';
import type { ExperimentMeasurement, MeasurementReader } from '../../../../measurement/read-measurement.js';
import type { OutcomesRepository } from '../outcomes.repository.js';
import { presentOutcome } from '../outcomes.presenter.js';
import type { OutcomeCreateBody } from './create-outcome.schema.js';

export type CreateOutcomeDeps = {
  repo: OutcomesRepository;
  /**
   * O serviço de criação de run, injetado. É ele que valida input, roda o
   * precheck, cobra e deduplica — reimplementar aqui seria um segundo caminho
   * de cobrança livre para divergir.
   */
  startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>;
  /**
   * Refaz a leitura pelo conector. Chamado só no caminho `fromSource`, e é o
   * que torna a confirmação uma concordância com a leitura em vez de um
   * transporte dela.
   */
  readMeasurement: MeasurementReader;
};

/** Um relatório é mais caro que um metadata; ainda assim, tem teto. */
const READ_TIMEOUT_MS = 20_000;

export function createOutcomeService(deps: CreateOutcomeDeps) {
  return async (
    input: OutcomeCreateBody & { workspaceId: string; experimentId: string; tenant: TenantContext; now?: Date },
  ) => {
    const { workspaceId, experimentId, tenant, now = new Date(), ...body } = input;

    const experiment = await deps.repo.experimentInWorkspace(workspaceId, experimentId);
    if (!experiment) throw new NotFoundError('Experiment not found');

    // A measurement dated in the future has not been observed yet, so recording
    // it as an observation would be a claim about something that has not
    // happened.
    if (body.observedAt && body.observedAt.getTime() > now.getTime()) {
      throw new BadRequestError('An outcome cannot be observed in the future');
    }

    // Antes de gravar: se a fonte recusar, não existe medição para registrar, e
    // gravar zero por falta de leitura seria inventar o resultado.
    const reading: ExperimentMeasurement | null = body.fromSource
      ? await deps.readMeasurement(workspaceId, experimentId, AbortSignal.timeout(READ_TIMEOUT_MS))
      : null;

    const value = reading ? reading.value : body.value;
    // Defesa em profundidade: o schema da rota já recusa, e um chamador interno
    // futuro não pode gravar um outcome sem número.
    if (value === undefined) throw new BadRequestError('An outcome needs a value');

    const row = await deps.repo.create(workspaceId, {
      experimentId,
      // Defaults to what the experiment measures: an outcome on a different
      // metric cannot be read against the experiment's baseline and target.
      metric: body.metric ?? experiment.metric,
      value,
      // A unidade informada vence a da fonte: o GA4 Data API não declara
      // unidade por métrica, e quem sabe se aquilo são reais ou chamadas é o
      // fundador.
      unit: body.unit ?? reading?.unit ?? undefined,
      // Deixado como o `observedAt` informado, ou o default da coluna (agora):
      // a leitura foi observada agora, e o período que ela cobre está gravado
      // em `periodStart`/`periodEnd`, não confundido com o instante da leitura.
      observedAt: body.observedAt,
      // Provenance for a hand-entered number. Left explicit rather than relying
      // on the column default so the value is visible where it is decided.
      source: reading ? reading.source : 'USER',
      ...(reading
        ? {
            periodStart: reading.periodStart,
            periodEnd: reading.periodEnd,
            externalRef: reading.externalRef,
            sourceDetail: reading.query as Prisma.InputJsonValue,
          }
        : {}),
    });

    // Depois de gravado, e só depois. O número é fato observado; um saldo curto
    // não pode custar a medição. Por isso o disparo é melhor-esforço e a recusa
    // volta nomeada, com retry na tela, em vez de virar exceção sobre um
    // outcome que já merece o 201.
    //
    // A deduplicação por `interpret-outcome:<hash de {experimentId}>` só olha
    // runs PENDING/RUNNING, então dois números gravados quase juntos
    // reaproveitam o run em voo — uma interpretação sobre os resultados atuais,
    // não duas — e um número gravado depois de a interpretação anterior ter
    // completado dispara um run novo.
    let interpretation: { agentRunId: string | null; reason: string | null } = { agentRunId: null, reason: null };
    try {
      const run = await deps.startRun({
        tenant,
        taskType: interpretOutcomeAgent.taskType,
        input: { experimentId },
      });
      interpretation = { agentRunId: run.id, reason: null };
    } catch (error) {
      interpretation = {
        agentRunId: null,
        reason: error instanceof Error ? error.message : 'unknown error',
      };
    }

    return {
      // Returned already read against the experiment's baseline and target, so
      // the number the caller just recorded comes back with its comparison.
      outcome: presentOutcome(row, {
        baselineValue: experiment.baselineValue,
        targetValue: experiment.targetValue,
      }),
      interpretation,
    };
  };
}
