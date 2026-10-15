/**
 * Structured Business Context Schema
 *
 * This defines the rich, structured data that lives in BusinessContextVersion.data (JSON column).
 * The AI agents use this information to reason about growth opportunities.
 */

// ─────────────────────────── Company Profile ───────────────────────────

export interface CompanyProfile {
  logoUrl?: string;
  foundedYear?: number;
  mission?: string;
  vision?: string;
  values?: string[];
  brandVoice?: string;
  fundingStage?: 'bootstrapped' | 'pre-seed' | 'seed' | 'series-a' | 'series-b' | 'series-c+' | 'public';
  headquarters?: string;
  employeeCount?: number;
  documentUrls?: string[];
}

// ─────────────────────────── Products & Services ───────────────────────────

export interface Product {
  id: string;
  name: string;
  description: string;
  targetAudience?: string;
  differentiator?: string;
  pricingModel?: 'free' | 'freemium' | 'subscription' | 'one-time' | 'usage-based' | 'custom';
  pricePoint?: string;
  status?: 'active' | 'beta' | 'planned' | 'sunset';
}

// ─────────────────────────── Competitive Landscape ───────────────────────────

export interface Competitor {
  name: string;
  url?: string;
  strengths: string[];
  weaknesses: string[];
  pricing?: string;
  positioning?: string;
  marketShare?: 'dominant' | 'major' | 'emerging' | 'niche';
}

export interface CompetitiveLandscape {
  competitors: Competitor[];
  ourDifferentiator?: string;
  marketPosition?: 'leader' | 'challenger' | 'follower' | 'niche';
  competitiveAdvantages: string[];
  threatsFromCompetitors: string[];
}

// ─────────────────────────── Market Context ───────────────────────────

export interface MarketContext {
  tam?: number;
  sam?: number;
  som?: number;
  marketGrowthRate?: number;
  trends: string[];
  opportunities: string[];
  threats: string[];
  maturity?: 'emerging' | 'growth' | 'mature' | 'declining';
}

// ─────────────────────────── Business Constraints ───────────────────────────

export interface BusinessConstraints {
  monthlyGrowthBudget?: number;
  teamSize?: number;
  growthTeamSize?: number;
  technicalCapabilities: string[];
  limitations: string[];
  regulatoryConstraints?: string[];
  urgency?: 'low' | 'medium' | 'high' | 'critical';
}

// ─────────────────────────── Current Performance ───────────────────────────

export interface CurrentPerformance {
  mrr?: number;
  arr?: number;
  totalCustomers?: number;
  activeCustomers?: number;
  churnRate?: number;
  monthlySignups?: number;
  cac?: number;
  ltv?: number;
  ltvCacRatio?: number;
  conversionRate?: number;
  timeToConvert?: number;
  channels: {
    channel: string;
    monthlyVisitors?: number;
    conversionRate?: number;
    cac?: number;
    contribution?: number;
  }[];
  baselineDate?: string;
}

// ─────────────────────────── Current Activities ───────────────────────────

export interface CurrentActivities {
  activeChannels: string[];
  contentProduction?: {
    blogPostsPerMonth?: number;
    socialPostsPerWeek?: number;
    emailCampaignsPerMonth?: number;
  };
  paidAdvertising?: {
    platforms: string[];
    monthlySpend?: number;
  };
  partnerships?: string[];
  other?: string[];
}

// ─────────────────────────── Project Objectives ───────────────────────────

export interface ProjectObjective {
  id: string;
  description: string;
  metric?: string;
  baseline?: number;
  target?: number;
  unit?: string;
  deadline?: string;
  status?: 'not-started' | 'in-progress' | 'achieved' | 'missed';
}

// ─────────────────────────── Projects ───────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  type?: 'product' | 'marketing' | 'sales' | 'operations' | 'technical' | 'other';
  status?: 'planned' | 'in-progress' | 'completed' | 'on-hold';
  startDate?: string;
  endDate?: string;
  budget?: number;
  owner?: string;
  objectives: ProjectObjective[];
}

// ─────────────────────────── Campaign KPIs ───────────────────────────

export interface CampaignKpi {
  name: string;
  target: number;
  current?: number;
  unit?: string;
}

// ─────────────────────────── Campaigns ───────────────────────────

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  channel?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  status?: 'planned' | 'running' | 'finished' | 'paused';
  projectId?: string;
  targetAudience?: string;
  kpis: CampaignKpi[];
}

// ─────────────────────────── Complete Business Context ───────────────────────────

export interface BusinessContextData {
  companyProfile?: CompanyProfile;
  products: Product[];
  competitiveLandscape?: CompetitiveLandscape;
  marketContext?: MarketContext;
  constraints?: BusinessConstraints;
  currentPerformance?: CurrentPerformance;
  currentActivities?: CurrentActivities;
  projects?: Project[];
  campaigns?: Campaign[];

  completeness?: number;
  lastReviewedAt?: string;
  notes?: string;
}

// ─────────────────────────── Helper Types ───────────────────────────

export type ContextSection =
  | 'company'
  | 'products'
  | 'competitive'
  | 'market'
  | 'constraints'
  | 'performance'
  | 'activities'
  | 'projects'
  | 'campaigns';

export const CONTEXT_SECTIONS: { key: ContextSection; label: string; description: string }[] = [
  {
    key: 'company',
    label: 'Company Profile',
    description: 'Brand identity, mission, vision, logo, and institutional documents',
  },
  {
    key: 'products',
    label: 'Products & Services',
    description: 'What you sell, to whom, and what makes it different',
  },
  {
    key: 'competitive',
    label: 'Competitive Landscape',
    description: 'Who you compete with and your differentiation',
  },
  {
    key: 'market',
    label: 'Market Context',
    description: 'Market size, growth, trends, and opportunities',
  },
  {
    key: 'constraints',
    label: 'Constraints & Resources',
    description: 'Budget, team, capabilities, and limitations',
  },
  {
    key: 'performance',
    label: 'Current Performance',
    description: 'Revenue, customers, CAC, LTV, and current channels',
  },
  {
    key: 'activities',
    label: 'Current Activities',
    description: "What growth activities you're doing today",
  },
  {
    key: 'projects',
    label: 'Projects',
    description: 'Growth projects with objectives, budgets, and timelines',
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    description: 'Marketing campaigns linked to projects, with KPIs',
  },
];

// ─────────────────────────── Validation Helpers ───────────────────────────

/**
 * Whether the founder answered this field at all.
 *
 * Zero is an answer. A pre-revenue business has an MRR of 0, no customers, and
 * frequently no growth budget — and those numbers are exactly what the growth
 * math needs as a baseline. Reading them as "unanswered" told the founder the
 * section was still empty right after they filled it, so the guide kept
 * offering the same section and the fill agent kept asking the same question:
 * a loop no amount of answering could end.
 *
 * Kept for strings too, so a section is not called filled by `''` — the empty
 * string really is the absence of an answer, unlike `0`.
 */
function answered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

export function calculateCompleteness(data: BusinessContextData): number {
  let filled = 0;
  let total = 0;

  // Company (weight: 2)
  total += 2;
  if (answered(data.companyProfile?.mission)) filled += 1;
  if (answered(data.companyProfile?.logoUrl) || data.companyProfile?.documentUrls?.length) filled += 1;

  // Products (weight: 2)
  total += 2;
  if (data.products && data.products.length > 0) filled += 2;

  // Competitive (weight: 1)
  total += 1;
  if (data.competitiveLandscape?.competitors && data.competitiveLandscape.competitors.length > 0) filled += 1;

  // Market (weight: 1)
  total += 1;
  if (data.marketContext?.trends && data.marketContext.trends.length > 0) filled += 1;

  // Constraints (weight: 1)
  total += 1;
  if (answered(data.constraints?.monthlyGrowthBudget) || answered(data.constraints?.teamSize)) filled += 1;

  // Performance (weight: 2)
  total += 2;
  if (answered(data.currentPerformance?.mrr) || answered(data.currentPerformance?.totalCustomers)) filled += 1;
  if (answered(data.currentPerformance?.cac) || answered(data.currentPerformance?.conversionRate)) filled += 1;

  // Activities (weight: 1)
  total += 1;
  if (data.currentActivities?.activeChannels && data.currentActivities.activeChannels.length > 0) filled += 1;

  // Projects (weight: 2)
  total += 2;
  if (data.projects && data.projects.length > 0) filled += 1;
  if (data.projects?.some((p) => p.objectives.length > 0)) filled += 1;

  // Campaigns (weight: 1)
  total += 1;
  if (data.campaigns && data.campaigns.length > 0) filled += 1;

  return Math.round((filled / total) * 100);
}

export function getIncompleteSections(data: BusinessContextData): ContextSection[] {
  const incomplete: ContextSection[] = [];

  if (!answered(data.companyProfile?.mission) && !answered(data.companyProfile?.logoUrl)) incomplete.push('company');
  if (!data.products || data.products.length === 0) incomplete.push('products');
  if (!data.competitiveLandscape?.competitors?.length) incomplete.push('competitive');
  if (!data.marketContext?.trends?.length) incomplete.push('market');
  if (!answered(data.constraints?.monthlyGrowthBudget) && !answered(data.constraints?.teamSize))
    incomplete.push('constraints');
  if (!answered(data.currentPerformance?.mrr) && !answered(data.currentPerformance?.totalCustomers))
    incomplete.push('performance');
  if (!data.currentActivities?.activeChannels?.length) incomplete.push('activities');
  if (!data.projects?.length) incomplete.push('projects');
  if (!data.campaigns?.length) incomplete.push('campaigns');

  return incomplete;
}
