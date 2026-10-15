import { z } from 'zod';

// Observed vs baseline vs target, as numbers (docs/domains/analytics.md §22).
// There is no verdict field and no `met` flag: §14 of experiments.md forbids
// deriving success from a free-text criterion, so the response carries the
// comparison and nothing that characterises it.
export const measurementComparisonSchema = z.object({
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  progressPct: z.number().nullable(),
});

export const outcomeSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid(),
  metric: z.string(),
  value: z.number(),
  unit: z.string().nullable(),
  observedAt: z.date(),
  // Provenance: where this number came from. Manual entry is still provenance
  // ("an Outcome without provenance is not trustworthy" — docs/domains/
  // analytics.md §11), which is why it is part of the response and not implied.
  source: z.string(),
  // `analytics.md` §11 pede source, external reference, observed at e ingestion
  // method. `sourceDetail` é o método por extenso — a consulta como a fonte a
  // recebeu — e não um enum vago. `confidence` fica fora de propósito: com uma
  // fonte só não há discordância a modelar (spec §8).
  periodStart: z.date().nullable(),
  periodEnd: z.date().nullable(),
  externalRef: z.string().nullable(),
  sourceDetail: z.unknown().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  comparison: measurementComparisonSchema,
});

export const outcomeResponse = z.object({ outcome: outcomeSchema });
export const outcomeListResponse = z.object({ outcomes: z.array(outcomeSchema) });
export const experimentIdParam = z.object({ id: z.string().uuid() });

/**
 * O que aconteceu com a interpretação que gravar o número dispara.
 *
 * Ambos nuláveis porque o disparo é melhor-esforço: `agentRunId` quando entrou
 * na fila, `reason` quando não entrou. O número está gravado nos dois casos —
 * a medição é fato observado, e o faturamento não pode apagá-la.
 */
export const outcomeInterpretation = z.object({
  agentRunId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
});

export const outcomeCreatedResponse = z.object({
  outcome: outcomeSchema,
  interpretation: outcomeInterpretation,
});
