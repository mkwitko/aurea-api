import { z } from 'zod';

export const dashboardStage = z.enum([
  'BUSINESS',
  'ICP',
  'GOAL',
  'RESEARCH',
  'STRATEGY',
  'EXPERIMENT',
  'RUN',
  'OUTCOME',
  'LEARN',
  'VALIDATE',
  'COMPLETE',
]);

export const nextActionKind = z.enum([
  'SET_UP_BUSINESS',
  'FILL_CONTEXT',
  'DEFINE_ICP',
  'SET_GOAL',
  'ACTIVATE_GOAL',
  'RUN_RESEARCH',
  'CHOOSE_STRATEGY',
  'CREATE_HYPOTHESIS',
  'DESIGN_EXPERIMENT',
  'PLAN_EXPERIMENT',
  'APPROVE_EXPERIMENT',
  'START_EXPERIMENT',
  'WAIT_FOR_EXPERIMENT',
  'COMPLETE_EXPERIMENT',
  'RESUME_EXPERIMENT',
  'RECORD_OUTCOME',
  'INTERPRET_OUTCOME',
  'VALIDATE_LEARNING',
  'START_NEXT_LOOP',
]);

export const railNode = z.enum(['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING']);
export const railState = z.enum(['DONE', 'CURRENT', 'TODO']);

export const recentKind = z.enum([
  'GOAL_SET',
  'RESEARCH_COMPLETED',
  'STRATEGY_ACCEPTED',
  'STRATEGY_CREATED',
  'EXPERIMENT_CREATED',
  'EXPERIMENT_COMPLETED',
  'OUTCOME_RECORDED',
  'LEARNING_CREATED',
  'LEARNING_VALIDATED',
]);

export const recentRefType = z.enum(['GOAL', 'STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING', 'AGENT_RUN']);

// Deliberately free of prose and of URLs: `label` is what the founder typed,
// everything else is an enum or an id. Display copy is the web app's job
// (three locales), and route shapes are React Router's (spec §3.4).
export const dashboardRecentItem = z.object({
  at: z.date(),
  kind: recentKind,
  refType: recentRefType,
  refId: z.string(),
  label: z.string(),
  count: z.number().int().nullable(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
});

export const dashboardNextAction = z.object({
  kind: nextActionKind,
  subjectLabel: z.string().nullable(),
  experimentId: z.string().nullable(),
  learningId: z.string().nullable(),
  endDate: z.date().nullable(),
});

export const dashboardSetup = z.object({
  business: z.boolean(),
  context: z.boolean(),
  icp: z.boolean(),
  goal: z.boolean(),
  research: z.boolean(),
  strategy: z.boolean(),
  hypothesis: z.boolean(),
  experiment: z.boolean(),
  completed: z.number().int(),
  total: z.literal(8),
});

export const dashboardRailEntry = z.object({ node: railNode, state: railState });

/**
 * Um experimento cujo teste terminou e cujo número não chegou.
 *
 * Sem prosa e sem url, como o resto deste schema: a cópia é do frontend (três
 * locales) e a rota é do React Router.
 */
export const dashboardPendingMeasurement = z.object({
  experimentId: z.string(),
  name: z.string(),
  metric: z.string(),
  endDate: z.date().nullable(),
});

export const dashboardLoop = z.object({
  number: z.number().int(),
  goal: z
    .object({
      id: z.string(),
      name: z.string(),
      metric: z.string(),
      targetValue: z.number().nullable(),
      unit: z.string().nullable(),
    })
    .nullable(),
  strategy: z.object({ id: z.string(), name: z.string() }).nullable(),
  experiment: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['DRAFT', 'PLANNED', 'APPROVED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED']),
      metric: z.string(),
      endDate: z.date().nullable(),
    })
    .nullable(),
  rail: z.array(dashboardRailEntry),
});

export const dashboardResponse = z.object({
  setup: dashboardSetup,
  stage: dashboardStage,
  nextAction: dashboardNextAction,
  // Null while setup is incomplete: there is no loop to describe yet, and the
  // web app should not have to decide that for itself (spec §3.7).
  loop: dashboardLoop.nullable(),
  recent: z.array(dashboardRecentItem),
  // `count` é a contagem real e `items` uma janela de cinco: a tela diz "+3" a
  // partir da diferença em vez de fingir que a lista é tudo.
  pendingMeasurement: z.object({
    count: z.number().int(),
    items: z.array(dashboardPendingMeasurement),
  }),
});

export type DashboardStage = z.infer<typeof dashboardStage>;
export type NextActionKind = z.infer<typeof nextActionKind>;
export type RailNode = z.infer<typeof railNode>;
export type DashboardRailEntry = z.infer<typeof dashboardRailEntry>;
export type DashboardNextAction = z.infer<typeof dashboardNextAction>;
export type DashboardRecentItem = z.infer<typeof dashboardRecentItem>;
export type DashboardSetup = z.infer<typeof dashboardSetup>;
export type DashboardResponse = z.infer<typeof dashboardResponse>;
export type DashboardPendingMeasurement = z.infer<typeof dashboardPendingMeasurement>;
