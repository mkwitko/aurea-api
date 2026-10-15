import { z } from 'zod';

export const selectPropertyBody = z.object({
  /**
   * O id numérico da property. `G-XXXXXXX` é o id de métrica do site e não
   * serve para consultar a API — recusar aqui é recusar antes de uma ida ao
   * Google que falharia sem explicar o porquê.
   */
  propertyId: z.string().regex(/^\d{1,20}$/, 'propertyId must be the numeric property id'),
});
