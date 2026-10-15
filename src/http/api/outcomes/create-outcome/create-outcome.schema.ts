import { z } from 'zod';

export const outcomeCreateBody = z
  .object({
    // Opcional no schema, obrigatório no caminho manual: o `refine` abaixo é
    // quem separa os dois. Finite de propósito: z.number() sozinho admite
    // Infinity e NaN, e nenhum dos dois é medição.
    value: z.number().finite().optional(),
    // Omitted means "the metric this experiment is about" — filled in by the
    // service from the experiment itself.
    metric: z.string().min(1).max(160).optional(),
    unit: z.string().max(40).optional(),
    observedAt: z.coerce.date().optional(),
    /**
     * "Concordo com a leitura da fonte." O cliente não manda valor nenhum: o
     * serviço lê pelo conector, usando a amarração e o período do experimento.
     *
     * Aceitar `value` junto seria um número sem origem com selo de origem,
     * pior que digitar à mão porque parece auditado (spec §8).
     */
    fromSource: z.boolean().optional(),
  })
  .refine((body) => (body.fromSource === true ? body.value === undefined : body.value !== undefined), {
    message: 'Send a value, or fromSource with no value',
    path: ['value'],
  });

export type OutcomeCreateBody = z.infer<typeof outcomeCreateBody>;
