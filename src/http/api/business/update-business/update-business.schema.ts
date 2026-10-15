import { businessCreateBody } from '../create-business/create-business.schema.js';

export const businessUpdateBody = businessCreateBody.partial();
export type BusinessUpdateBody = typeof businessUpdateBody._type;
