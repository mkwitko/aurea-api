import { z } from 'zod';
import { ga4ConfigSchema } from '../../../integrations/analytics/index.js';

export const metricBindingProvider = z.enum(['GA4']);

/**
 * A config é validada por provider. O banco guarda Json, a entrada não é livre:
 * uma amarração malformada só falharia na hora de medir, e o erro chegaria
 * disfarçado de problema da fonte.
 */
export const putMetricBindingBody = z.object({
  provider: metricBindingProvider,
  config: ga4ConfigSchema,
});

export const metricBindingSchema = z.object({
  id: z.string(),
  experimentId: z.string(),
  provider: z.string(),
  config: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const metricBindingResponse = z.object({ binding: metricBindingSchema });
