import { ExperimentStatus, LearningStatus } from '@prisma/client';
import type {
  DashboardNextAction,
  DashboardRailEntry,
  DashboardRecentItem,
  DashboardSetup,
  DashboardStage,
  NextActionKind,
  RailNode,
} from './dashboard.schema.js';

export interface SpineLearning {
  id: string;
  status: LearningStatus;
  createdAt: Date;
}

export interface SpineExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  metric: string;
  endDate: Date | null;
  outcomeCount: number;
  learnings: SpineLearning[];
  strategyId: string;
}

/**
 * Everything the stage machine needs, and nothing it does not. Kept as plain
 * data so the whole of spec §3.2 is testable without HTTP or a database — the
 * repository's job is to fill this in, not to decide anything with it.
 */
export interface DashboardSnapshot {
  now: Date;
  hasBusiness: boolean;
  icpCount: number;
  openGoalCount: number;
  /** Dos abertos, quantos estão de fato sendo perseguidos. */
  activeGoalCount: number;
  /** O rascunho mais recente, quando não há nenhum ativo — o que ativar. */
  draftGoal: { id: string; name: string } | null;
  researchRunCount: number;
  strategyCount: number;
  /** Seções do contexto com conteúdo. O mesmo contador do precheck do propose-icp. */
  contextSectionCount: number;
  hypothesisCount: number;
  experimentCount: number;
  /** Latest non-cancelled experiment, or null. See spec §3.1. */
  spine: SpineExperiment | null;
}

/**
 * The setup gate, in order. The first entry whose `done` is false is the
 * stage.
 *
 * `RESEARCH` conta apenas run CONCLUÍDA. A spec §3.2 dizia o contrário — run
 * de qualquer status, porque "o fundador fez a etapa" — e isso se mostrou
 * errado na prática: uma pesquisa que falhou não gravou nada no contexto, e o
 * check verde escondia o erro. Decisão do dono do produto em 2026-07-30.
 */
const SETUP: { key: keyof Omit<DashboardSetup, 'completed' | 'total'>; stage: DashboardStage; kind: NextActionKind; done: (s: DashboardSnapshot) => boolean }[] = [
  { key: 'business', stage: 'BUSINESS', kind: 'SET_UP_BUSINESS', done: (s) => s.hasBusiness },
  // Três seções é o mesmo piso que o propose-icp exige antes de propor um ICP.
  { key: 'context', stage: 'BUSINESS', kind: 'FILL_CONTEXT', done: (s) => s.contextSectionCount >= 3 },
  { key: 'icp', stage: 'ICP', kind: 'DEFINE_ICP', done: (s) => s.icpCount > 0 },
  { key: 'goal', stage: 'GOAL', kind: 'SET_GOAL', done: (s) => s.openGoalCount > 0 },
  { key: 'research', stage: 'RESEARCH', kind: 'RUN_RESEARCH', done: (s) => s.researchRunCount > 0 },
  { key: 'strategy', stage: 'STRATEGY', kind: 'CHOOSE_STRATEGY', done: (s) => s.strategyCount > 0 },
  { key: 'hypothesis', stage: 'STRATEGY', kind: 'CREATE_HYPOTHESIS', done: (s) => s.hypothesisCount > 0 },
  // O portão fecha quando existe experimento — exatamente quando spine !== null.
  // A primeira jogada do loop era esta mesma; ela só passou a ser resolvida uma
  // camada antes. Ver spec §5.
  { key: 'experiment', stage: 'EXPERIMENT', kind: 'DESIGN_EXPERIMENT', done: (s) => s.experimentCount > 0 },
];

/** Índice da etapa de objetivo em SETUP, lido pela regra de ativação. */
const GOAL_STEP = 3;

export function setupFlags(snapshot: DashboardSnapshot): DashboardSetup {
  const flags = Object.fromEntries(SETUP.map((step) => [step.key, step.done(snapshot)])) as Omit<
    DashboardSetup,
    'completed' | 'total'
  >;
  const completed = Object.values(flags).filter(Boolean).length;
  return { ...flags, completed, total: 8 };
}

export function isSetupComplete(snapshot: DashboardSnapshot): boolean {
  return SETUP.every((step) => step.done(snapshot));
}

type Resolution = { stage: DashboardStage; kind: NextActionKind; learningId?: string };

function resolveCompleted(spine: SpineExperiment): Resolution {
  // Order is load-bearing (spec §3.2): outcomes, then validated, then
  // candidate, then fall through to LEARN.
  if (spine.outcomeCount === 0) return { stage: 'OUTCOME', kind: 'RECORD_OUTCOME' };
  if (spine.learnings.some((l) => l.status === LearningStatus.VALIDATED)) {
    return { stage: 'COMPLETE', kind: 'START_NEXT_LOOP' };
  }
  const candidates = spine.learnings
    .filter((l) => l.status === LearningStatus.CANDIDATE)
    // Oldest first: the one that has been waiting longest, and a
    // deterministic answer when timestamps collide.
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const oldest = candidates[0];
  if (oldest) return { stage: 'VALIDATE', kind: 'VALIDATE_LEARNING', learningId: oldest.id };
  // Sem aprendizado, ou todos rejeitados/arquivados: o ciclo não fechou, então
  // peça uma leitura em vez de encalhar. A tela do experimento continua
  // oferecendo o formulário manual — o painel só não o anuncia.
  return { stage: 'LEARN', kind: 'INTERPRET_OUTCOME' };
}

function resolveLoop(spine: SpineExperiment | null, now: Date): Resolution {
  if (!spine) return { stage: 'EXPERIMENT', kind: 'DESIGN_EXPERIMENT' };
  switch (spine.status) {
    case ExperimentStatus.DRAFT:
      return { stage: 'RUN', kind: 'PLAN_EXPERIMENT' };
    case ExperimentStatus.PLANNED:
      return { stage: 'RUN', kind: 'APPROVE_EXPERIMENT' };
    case ExperimentStatus.APPROVED:
      return { stage: 'RUN', kind: 'START_EXPERIMENT' };
    case ExperimentStatus.PAUSED:
      return { stage: 'RUN', kind: 'RESUME_EXPERIMENT' };
    case ExperimentStatus.RUNNING:
      // `endDate` is the *planned* end — there is no startedAt/actual-end
      // column on the model (spec §3.3).
      return spine.endDate !== null && spine.endDate.getTime() <= now.getTime()
        ? { stage: 'RUN', kind: 'COMPLETE_EXPERIMENT' }
        : { stage: 'RUN', kind: 'WAIT_FOR_EXPERIMENT' };
    case ExperimentStatus.COMPLETED:
      return resolveCompleted(spine);
    case ExperimentStatus.CANCELLED:
      // Unreachable: the spine query excludes CANCELLED. Handled rather than
      // thrown so a future query change degrades to "design an experiment"
      // instead of 500ing the dashboard.
      return { stage: 'EXPERIMENT', kind: 'DESIGN_EXPERIMENT' };
  }
}

const RAIL_ORDER: RailNode[] = ['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING'];

/** Which rail node a loop stage puts the founder on. COMPLETE promotes none. */
const CURRENT_NODE: Partial<Record<DashboardStage, RailNode>> = {
  EXPERIMENT: 'EXPERIMENT',
  RUN: 'EXPERIMENT',
  OUTCOME: 'OUTCOME',
  LEARN: 'LEARNING',
  VALIDATE: 'LEARNING',
};

function resolveRail(stage: DashboardStage, spine: SpineExperiment | null): DashboardRailEntry[] {
  const done: Record<RailNode, boolean> = {
    // Reaching the rail at all means setup passed, which required a strategy.
    STRATEGY: true,
    EXPERIMENT: spine?.status === ExperimentStatus.COMPLETED,
    OUTCOME: (spine?.outcomeCount ?? 0) > 0,
    LEARNING: spine?.learnings.some((l) => l.status === LearningStatus.VALIDATED) ?? false,
  };
  const current = CURRENT_NODE[stage];
  return RAIL_ORDER.map((node) => ({
    node,
    state: done[node] ? 'DONE' : node === current ? 'CURRENT' : 'TODO',
  }));
}

export function resolveDashboardState(snapshot: DashboardSnapshot): {
  stage: DashboardStage;
  nextAction: DashboardNextAction;
  rail: DashboardRailEntry[];
} {
  const gap = SETUP.find((step) => !step.done(snapshot));

  // Um rascunho conta como objetivo criado — quem acabou de criar não pode ser
  // mandado criar outro. Mas ele ainda não é o número que a AUREA persegue, e
  // pesquisar mercado para um objetivo inativo é trabalho sem destino. Então,
  // enquanto nenhum estiver ativo, ativar vem antes de tudo que viria depois
  // da etapa de objetivo. As etapas ANTERIORES continuam mandando: sem negócio
  // ou sem ICP, ativar um objetivo não é o próximo passo de ninguém.
  const beforeGoal = gap !== undefined && SETUP.indexOf(gap) < GOAL_STEP;
  if (!beforeGoal && snapshot.activeGoalCount === 0 && snapshot.draftGoal) {
    return {
      stage: 'GOAL',
      nextAction: {
        kind: 'ACTIVATE_GOAL',
        subjectLabel: snapshot.draftGoal.name,
        experimentId: null,
        learningId: null,
        endDate: null,
      },
      rail: [],
    };
  }

  if (gap) {
    return {
      stage: gap.stage,
      nextAction: {
        kind: gap.kind,
        subjectLabel: null,
        experimentId: null,
        learningId: null,
        endDate: null,
      },
      // No loop yet, so no rail. `loop` is null in the response either way.
      rail: [],
    };
  }

  const { stage, kind, learningId } = resolveLoop(snapshot.spine, snapshot.now);
  return {
    stage,
    nextAction: {
      kind,
      subjectLabel: snapshot.spine?.name ?? null,
      experimentId: snapshot.spine?.id ?? null,
      learningId: learningId ?? null,
      endDate: kind === 'WAIT_FOR_EXPERIMENT' ? (snapshot.spine?.endDate ?? null) : null,
    },
    rail: resolveRail(stage, snapshot.spine),
  };
}

/**
 * Raw rows the feed is derived from. Every field here is a column that
 * already exists: this screen adds no events table and no AuditLog, which
 * `mvp.md` §6 defers (spec §3.5). The cost is that the feed shows creations
 * and terminal timestamps, never intermediate status changes.
 */
export interface RecentSources {
  goals: { id: string; name: string; createdAt: Date }[];
  researchRuns: { id: string; completedAt: Date | null; output: unknown }[];
  strategies: { id: string; name: string; createdAt: Date; sourceAgentRunId: string | null }[];
  experiments: { id: string; name: string; createdAt: Date; completedAt: Date | null }[];
  outcomes: { id: string; metric: string; value: number; unit: string | null; observedAt: Date }[];
  learnings: { id: string; title: string; createdAt: Date; validatedAt: Date | null }[];
}

type PartialItem = Omit<DashboardRecentItem, 'count' | 'value' | 'unit'> &
  Partial<Pick<DashboardRecentItem, 'count' | 'value' | 'unit'>>;

function item(partial: PartialItem): DashboardRecentItem {
  return { count: null, value: null, unit: null, ...partial };
}

/**
 * How many findings a research run produced, or null when the output is not
 * the shape this expects. `AgentRun.output` is Json — a refused or
 * half-written run can hold anything, and a dashboard is the wrong place to
 * throw over it.
 */
function findingCount(output: unknown): number | null {
  if (typeof output !== 'object' || output === null) return null;
  const findings = (output as { findings?: unknown }).findings;
  return Array.isArray(findings) ? findings.length : null;
}

export function buildRecent(sources: RecentSources, limit = 8): DashboardRecentItem[] {
  const items: DashboardRecentItem[] = [];

  for (const goal of sources.goals) {
    items.push(item({ at: goal.createdAt, kind: 'GOAL_SET', refType: 'GOAL', refId: goal.id, label: goal.name }));
  }

  for (const run of sources.researchRuns) {
    if (!run.completedAt) continue;
    items.push(
      item({
        at: run.completedAt,
        kind: 'RESEARCH_COMPLETED',
        refType: 'AGENT_RUN',
        refId: run.id,
        // The run has no name of its own; the count is what the web app
        // renders, through a pluralized key.
        label: '',
        count: findingCount(run.output),
      }),
    );
  }

  for (const strategy of sources.strategies) {
    items.push(
      item({
        at: strategy.createdAt,
        // A strategy with a source run came out of the Strategy Agent and was
        // accepted; one without was written by hand.
        kind: strategy.sourceAgentRunId ? 'STRATEGY_ACCEPTED' : 'STRATEGY_CREATED',
        refType: 'STRATEGY',
        refId: strategy.id,
        label: strategy.name,
      }),
    );
  }

  for (const experiment of sources.experiments) {
    items.push(
      item({
        at: experiment.createdAt,
        kind: 'EXPERIMENT_CREATED',
        refType: 'EXPERIMENT',
        refId: experiment.id,
        label: experiment.name,
      }),
    );
    if (experiment.completedAt) {
      items.push(
        item({
          at: experiment.completedAt,
          kind: 'EXPERIMENT_COMPLETED',
          refType: 'EXPERIMENT',
          refId: experiment.id,
          label: experiment.name,
        }),
      );
    }
  }

  for (const outcome of sources.outcomes) {
    items.push(
      item({
        at: outcome.observedAt,
        kind: 'OUTCOME_RECORDED',
        refType: 'OUTCOME',
        refId: outcome.id,
        label: outcome.metric,
        value: outcome.value,
        unit: outcome.unit,
      }),
    );
  }

  for (const learning of sources.learnings) {
    items.push(
      item({
        at: learning.createdAt,
        kind: 'LEARNING_CREATED',
        refType: 'LEARNING',
        refId: learning.id,
        label: learning.title,
      }),
    );
    if (learning.validatedAt) {
      items.push(
        item({
          at: learning.validatedAt,
          kind: 'LEARNING_VALIDATED',
          refType: 'LEARNING',
          refId: learning.id,
          label: learning.title,
        }),
      );
    }
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
