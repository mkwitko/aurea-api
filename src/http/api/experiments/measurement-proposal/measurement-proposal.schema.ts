import { z } from 'zod';

/**
 * Plana, e não embrulhada em `{ proposal }` como as respostas de entidade: isto
 * não é um recurso do Growth Brain, é uma leitura transitória — nada foi
 * gravado, e não há id para buscar de volta (spec §7).
 */
export const measurementProposalResponse = z.object({
  value: z.number(),
  /** Null quando a fonte não declara unidade — não é o mesmo que adimensional. */
  unit: z.string().nullable(),
  periodStart: z.date(),
  periodEnd: z.date(),
  externalRef: z.string(),
  /** A consulta exata que produziu o número, para o fundador poder auditá-la. */
  query: z.unknown(),
  source: z.string(),
});
