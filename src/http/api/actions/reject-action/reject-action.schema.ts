import { z } from 'zod';

export const rejectActionBody = z.object({
  /**
   * Obrigatório, e com `trim`: uma rejeição sem motivo devolve o trabalho ao
   * autor sem dizer o que corrigir. `min(1)` depois do trim recusa espaços.
   */
  comment: z.string().trim().min(1).max(2000),
});
