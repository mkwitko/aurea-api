import { z } from 'zod';

export const googleAuthorizeResponse = z.object({
  /** A url de consentimento. O frontend navega para ela; ele não a monta. */
  url: z.string().url(),
});
