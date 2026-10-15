import { z } from 'zod';
import { businessContextDataSchema } from '../business-context-data.schema.js';

const shape = businessContextDataSchema.shape;

/**
 * `businessContextDataSchema.shape.*` wraps every section in `.optional()` (object
 * sections) or `.default([])` (array sections) — correct for reading a partially
 * filled context out of storage, wrong for an inbound write, where an absent field
 * must mean "malformed request", not "reset it". Unwrap each storage schema back to
 * its bare shape so `data` is required in the wire contract.
 */
const requiredCompanyProfile = shape.companyProfile.unwrap();
const requiredCompetitiveLandscape = shape.competitiveLandscape.unwrap();
const requiredMarketContext = shape.marketContext.unwrap();
const requiredConstraints = shape.constraints.unwrap();
const requiredCurrentPerformance = shape.currentPerformance.unwrap();
const requiredCurrentActivities = shape.currentActivities.unwrap();
const requiredProducts = shape.products.removeDefault();
const requiredProjects = shape.projects.removeDefault();
const requiredCampaigns = shape.campaigns.removeDefault();

/**
 * Names the nine section shapes for `createJsonSchemaTransformObject` (see `src/app.ts`).
 * `fastify-type-provider-zod` registers a component under `components.schemas` for each
 * entry here, then rewrites any inline occurrence with matching JSON-Schema shape (by
 * structural equality, not object identity — see `dist/src/ref.js`) into a `$ref`. Passing
 * these exact schema instances — the ones used as the `data` branch below — is what makes
 * `updateBusinessContextSection`'s request body reference them instead of inlining them.
 */
export const businessContextSectionComponentSchemas = {
  CompanySection: requiredCompanyProfile,
  ProductsSection: requiredProducts,
  CompetitiveSection: requiredCompetitiveLandscape,
  MarketSection: requiredMarketContext,
  ConstraintsSection: requiredConstraints,
  PerformanceSection: requiredCurrentPerformance,
  ActivitiesSection: requiredCurrentActivities,
  ProjectsSection: requiredProjects,
  CampaignsSection: requiredCampaigns,
};

/**
 * Proveniência opcional: quando a gravação vem de uma proposta de IA que o
 * usuário revisou, a versão registra `source = AI` e o run que a produziu. A
 * coluna e o membro `AI` do enum existem desde a primeira migração e nunca
 * foram alimentados — sem isto o fundador não tem como distinguir o que ele
 * escreveu do que um modelo propôs.
 */
const provenance = { sourceAgentRunId: z.string().uuid().optional() };

/**
 * Corpo de PUT /business/context/section.
 *
 * A união discriminada faz a validação acontecer na camada de schema do Fastify,
 * não dentro do handler. Isso importa por dois motivos: um ZodError lançado no
 * handler não casa com `hasZodFastifySchemaValidationErrors` no error handler e
 * viraria HTTP 500, e o OpenAPI passa a carregar a forma real de cada seção —
 * que é o que permite gerar os schemas Zod do frontend com o Kubb.
 */
export const updateSectionBody = z.discriminatedUnion('section', [
  z.object({ section: z.literal('company'), data: requiredCompanyProfile, ...provenance }),
  z.object({ section: z.literal('products'), data: requiredProducts, ...provenance }),
  z.object({ section: z.literal('competitive'), data: requiredCompetitiveLandscape, ...provenance }),
  z.object({ section: z.literal('market'), data: requiredMarketContext, ...provenance }),
  z.object({ section: z.literal('constraints'), data: requiredConstraints, ...provenance }),
  z.object({ section: z.literal('performance'), data: requiredCurrentPerformance, ...provenance }),
  z.object({ section: z.literal('activities'), data: requiredCurrentActivities, ...provenance }),
  z.object({ section: z.literal('projects'), data: requiredProjects, ...provenance }),
  z.object({ section: z.literal('campaigns'), data: requiredCampaigns, ...provenance }),
]);

export type UpdateSectionBody = z.infer<typeof updateSectionBody>;
export type ContextSectionKey = UpdateSectionBody['section'];
