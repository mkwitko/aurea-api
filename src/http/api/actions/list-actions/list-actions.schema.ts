import { z } from 'zod';
import { actionStatusEnum } from '../actions.schema.js';

export const listActionsQuery = z.object({
  status: actionStatusEnum.optional(),
  experimentId: z.string().uuid().optional(),
});
