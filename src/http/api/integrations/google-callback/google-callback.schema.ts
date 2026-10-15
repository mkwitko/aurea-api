import { z } from 'zod';

/**
 * Tudo opcional: é o Google que preenche, e um callback malformado tem de
 * chegar ao handler para virar recusa nomeada em vez de erro de validação sem
 * contexto.
 */
export const googleCallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
