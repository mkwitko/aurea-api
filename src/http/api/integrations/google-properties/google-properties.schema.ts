import { z } from 'zod';

export const googlePropertiesResponse = z.object({
  properties: z.array(
    z.object({
      propertyId: z.string(),
      displayName: z.string(),
      accountName: z.string(),
    }),
  ),
  /**
   * A fonte tinha mais do que uma página. Booleano e não contagem: a API não
   * informa total, e dizer "faltaram N" seria um número sem origem.
   */
  truncated: z.boolean(),
});
