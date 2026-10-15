import type { PrismaClient } from '@prisma/client';
import {
  AnalyticsProviderError,
  createGa4Provider,
  minterFor,
  type AnalyticsProvider,
} from '../integrations/analytics/index.js';
import { createIntegrationsRepository } from '../http/api/integrations/integrations.repository.js';
import { openIntegrationCredential } from '../http/api/integrations/integrations.service.js';
import {
  MeasurementReadFailedError,
  NoAnalyticsPropertyError,
  NoAnalyticsSourceError,
  NoMeasurementPeriodError,
  NoMetricBindingError,
  NotFoundError,
} from '../lib/errors.js';

/** Uma leitura pronta para virar proposta na tela ou proveniência no Outcome. */
export type ExperimentMeasurement = {
  value: number;
  unit: string | null;
  periodStart: Date;
  periodEnd: Date;
  externalRef: string;
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  query: unknown;
  /** O provider que devolveu o número. Vai para `Outcome.source`. */
  source: string;
};

export type MeasurementReader = (
  workspaceId: string,
  experimentId: string,
  signal: AbortSignal,
) => Promise<ExperimentMeasurement>;

/**
 * A fábrica do conector, injetável. É este o seam que mantém a suíte fora da
 * rede: nenhum teste precisa lembrar de substituir um decorator ambiente.
 */
export type CreateProvider = (args: {
  propertyId: string;
  credentials: string;
  authKind: string;
}) => AnalyticsProvider;

const defaultCreateProvider: CreateProvider = ({ propertyId, credentials, authKind }) =>
  createGa4Provider({ propertyId, mintToken: minterFor(authKind, credentials) });

/**
 * O único caminho que transforma "este experimento" num número lido de fora.
 *
 * Usado em dois lugares — a proposta transitória e a confirmação que grava o
 * Outcome — de propósito: se a confirmação usasse outro caminho, o número
 * gravado poderia não ser o número mostrado.
 *
 * A ordem das recusas é amarração → fonte → período, e ela é deliberada: sem
 * amarração não se sabe nem qual provider consultar, e sem fonte não há o que
 * abrir. Cada recusa tem código próprio porque a tela faz coisas diferentes
 * com cada uma.
 */
export function createMeasurementReader(deps: {
  prisma: PrismaClient;
  createProvider?: CreateProvider;
}): MeasurementReader {
  const createProvider = deps.createProvider ?? defaultCreateProvider;
  const integrations = createIntegrationsRepository(deps.prisma);

  return async (workspaceId, experimentId, signal) => {
    const experiment = await deps.prisma.experiment.findFirst({
      where: { id: experimentId, workspaceId },
      select: { id: true, startDate: true, endDate: true },
    });
    // Escopado pelo workspace: um id de outro tenant lê como ausente.
    if (!experiment) throw new NotFoundError('Experiment not found');

    const binding = await deps.prisma.metricBinding.findFirst({ where: { workspaceId, experimentId } });
    if (!binding) throw new NoMetricBindingError();

    const row = await integrations.find(workspaceId, binding.provider);
    if (!row) throw new NoAnalyticsSourceError();

    // Conectado sem property: nada a ler, e a recusa diz qual é o passo que
    // falta em vez de mandar conectar de novo.
    if (!row.externalId) throw new NoAnalyticsPropertyError();

    // As datas que o fundador declarou, e as mesmas que o relógio cumpriu.
    // Nenhum default: um período inventado mede outro experimento (spec §7).
    const { startDate, endDate } = experiment;
    if (!startDate || !endDate) throw new NoMeasurementPeriodError();

    // Montar o conector pode falhar por si: `minterFor` recusa um `authKind`
    // desconhecido e recusa OAUTH num servidor que perdeu a variável de
    // ambiente. Fora de um try isso sairia como 500 sem mensagem.
    //
    // E **não** marca a integração como FAILED, ao contrário da falha de
    // leitura abaixo: aqui a credencial está boa e o servidor está mal
    // configurado, e mandar o fundador reconectar não conserta variável de
    // ambiente ausente.
    let provider: AnalyticsProvider;
    try {
      provider = createProvider({
        propertyId: row.externalId,
        credentials: openIntegrationCredential(row),
        authKind: row.authKind,
      });
    } catch (error) {
      throw new MeasurementReadFailedError({
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }

    try {
      const reading = await provider.readMetric(binding.config, { startDate, endDate }, signal);
      return {
        value: reading.value,
        unit: reading.unit,
        periodStart: startDate,
        periodEnd: endDate,
        externalRef: reading.externalRef,
        query: reading.query,
        source: binding.provider,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      // O status guardado passa a FAILED com a mensagem da fonte: a tela de
      // conexão é onde o fundador vai olhar depois, e ela não pode custar uma
      // ida ao Google por render (spec §4).
      if (error instanceof AnalyticsProviderError) {
        await integrations.markFailed(row.id, reason, new Date());
      }
      throw new MeasurementReadFailedError({ reason });
    }
  };
}
