import { z } from 'zod';

// ─────────────────────────── Company Profile ───────────────────────────

const companyProfileSchema = z.object({
  logoUrl: z.string().url().optional(),
  foundedYear: z.number().int().positive().optional(),
  mission: z.string().optional(),
  vision: z.string().optional(),
  values: z.array(z.string()).default([]),
  brandVoice: z.string().optional(),
  fundingStage: z.enum(['bootstrapped', 'pre-seed', 'seed', 'series-a', 'series-b', 'series-c+', 'public']).optional(),
  headquarters: z.string().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  documentUrls: z.array(z.string().url()).default([]),
});

// ─────────────────────────── Products & Services ───────────────────────────

const productSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Product name is required'),
  description: z.string().min(1, 'Product description is required'),
  targetAudience: z.string().optional(),
  differentiator: z.string().optional(),
  pricingModel: z.enum(['free', 'freemium', 'subscription', 'one-time', 'usage-based', 'custom']).optional(),
  pricePoint: z.string().optional(),
  status: z.enum(['active', 'beta', 'planned', 'sunset']).optional(),
});

// ─────────────────────────── Competitive Landscape ───────────────────────────

const competitorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  pricing: z.string().optional(),
  positioning: z.string().optional(),
  marketShare: z.enum(['dominant', 'major', 'emerging', 'niche']).optional(),
});

const competitiveLandscapeSchema = z.object({
  competitors: z.array(competitorSchema).default([]),
  ourDifferentiator: z.string().optional(),
  marketPosition: z.enum(['leader', 'challenger', 'follower', 'niche']).optional(),
  competitiveAdvantages: z.array(z.string()).default([]),
  threatsFromCompetitors: z.array(z.string()).default([]),
});

// ─────────────────────────── Market Context ───────────────────────────

const marketContextSchema = z.object({
  tam: z.number().positive().optional(),
  sam: z.number().positive().optional(),
  som: z.number().positive().optional(),
  marketGrowthRate: z.number().optional(),
  trends: z.array(z.string()).default([]),
  opportunities: z.array(z.string()).default([]),
  threats: z.array(z.string()).default([]),
  maturity: z.enum(['emerging', 'growth', 'mature', 'declining']).optional(),
});

// ─────────────────────────── Business Constraints ───────────────────────────

const businessConstraintsSchema = z.object({
  monthlyGrowthBudget: z.number().nonnegative().optional(),
  teamSize: z.number().int().positive().optional(),
  growthTeamSize: z.number().int().nonnegative().optional(),
  technicalCapabilities: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  regulatoryConstraints: z.array(z.string()).default([]),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

// ─────────────────────────── Current Performance ───────────────────────────

const channelPerformanceSchema = z.object({
  channel: z.string().min(1),
  monthlyVisitors: z.number().int().nonnegative().optional(),
  conversionRate: z.number().nonnegative().optional(),
  cac: z.number().nonnegative().optional(),
  contribution: z.number().min(0).max(100).optional(),
});

const currentPerformanceSchema = z.object({
  mrr: z.number().nonnegative().optional(),
  arr: z.number().nonnegative().optional(),
  totalCustomers: z.number().int().nonnegative().optional(),
  activeCustomers: z.number().int().nonnegative().optional(),
  churnRate: z.number().nonnegative().optional(),
  monthlySignups: z.number().int().nonnegative().optional(),
  cac: z.number().nonnegative().optional(),
  ltv: z.number().nonnegative().optional(),
  ltvCacRatio: z.number().nonnegative().optional(),
  conversionRate: z.number().nonnegative().optional(),
  timeToConvert: z.number().nonnegative().optional(),
  channels: z.array(channelPerformanceSchema).default([]),
  baselineDate: z.string().datetime().optional(),
});

// ─────────────────────────── Current Activities ───────────────────────────

const contentProductionSchema = z.object({
  blogPostsPerMonth: z.number().int().nonnegative().optional(),
  socialPostsPerWeek: z.number().int().nonnegative().optional(),
  emailCampaignsPerMonth: z.number().int().nonnegative().optional(),
});

const paidAdvertisingSchema = z.object({
  platforms: z.array(z.string()).default([]),
  monthlySpend: z.number().nonnegative().optional(),
});

const currentActivitiesSchema = z.object({
  activeChannels: z.array(z.string()).default([]),
  contentProduction: contentProductionSchema.optional(),
  paidAdvertising: paidAdvertisingSchema.optional(),
  partnerships: z.array(z.string()).default([]),
  other: z.array(z.string()).default([]),
});

// ─────────────────────────── Project Objectives ───────────────────────────

const projectObjectiveSchema = z.object({
  id: z.string(),
  description: z.string().min(1, 'Objective description is required'),
  metric: z.string().optional(),
  baseline: z.number().optional(),
  target: z.number().optional(),
  unit: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(['not-started', 'in-progress', 'achieved', 'missed']).optional(),
});

// ─────────────────────────── Projects ───────────────────────────

const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  type: z.enum(['product', 'marketing', 'sales', 'operations', 'technical', 'other']).optional(),
  status: z.enum(['planned', 'in-progress', 'completed', 'on-hold']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  owner: z.string().optional(),
  objectives: z.array(projectObjectiveSchema).default([]),
});

// ─────────────────────────── Campaign KPIs ───────────────────────────

const campaignKpiSchema = z.object({
  name: z.string().min(1),
  target: z.number(),
  current: z.number().optional(),
  unit: z.string().optional(),
});

// ─────────────────────────── Campaigns ───────────────────────────

const campaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional(),
  channel: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(['planned', 'running', 'finished', 'paused']).optional(),
  projectId: z.string().optional(),
  targetAudience: z.string().optional(),
  kpis: z.array(campaignKpiSchema).default([]),
});

// ─────────────────────────── Complete Business Context ───────────────────────────

export const businessContextDataSchema = z.object({
  companyProfile: companyProfileSchema.optional(),
  products: z.array(productSchema).default([]),
  competitiveLandscape: competitiveLandscapeSchema.optional(),
  marketContext: marketContextSchema.optional(),
  constraints: businessConstraintsSchema.optional(),
  currentPerformance: currentPerformanceSchema.optional(),
  currentActivities: currentActivitiesSchema.optional(),
  projects: z.array(projectSchema).default([]),
  campaigns: z.array(campaignSchema).default([]),

  completeness: z.number().min(0).max(100).optional(),
  lastReviewedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export type BusinessContextData = z.infer<typeof businessContextDataSchema>;
export type CompanyProfile = z.infer<typeof companyProfileSchema>;
export type Product = z.infer<typeof productSchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type CompetitiveLandscape = z.infer<typeof competitiveLandscapeSchema>;
export type MarketContext = z.infer<typeof marketContextSchema>;
export type BusinessConstraints = z.infer<typeof businessConstraintsSchema>;
export type CurrentPerformance = z.infer<typeof currentPerformanceSchema>;
export type CurrentActivities = z.infer<typeof currentActivitiesSchema>;
export type ProjectObjective = z.infer<typeof projectObjectiveSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CampaignKpi = z.infer<typeof campaignKpiSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type ChannelPerformance = z.infer<typeof channelPerformanceSchema>;
