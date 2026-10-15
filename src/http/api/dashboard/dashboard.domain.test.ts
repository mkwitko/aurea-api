import { describe, expect, it } from 'vitest';
import { ExperimentStatus, LearningStatus } from '@prisma/client';
import { TRANSITIONS } from '../experiments/experiments.domain.js';
import {
  isSetupComplete,
  resolveDashboardState,
  setupFlags,
  type DashboardSnapshot,
  type SpineExperiment,
} from './dashboard.domain.js';

const NOW = new Date('2026-07-29T12:00:00Z');

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    now: NOW,
    hasBusiness: true,
    icpCount: 1,
    openGoalCount: 1,
    // O padrão é o caso saudável: o objetivo aberto é um objetivo ativo, e não
    // há rascunho esperando ativação — assim os testes das outras etapas não
    // caem na regra de ativação sem querer.
    activeGoalCount: 1,
    draftGoal: null,
    researchRunCount: 1,
    strategyCount: 1,
    contextSectionCount: 3,
    hypothesisCount: 1,
    experimentCount: 1,
    spine: null,
    ...overrides,
  };
}

function spine(overrides: Partial<SpineExperiment> = {}): SpineExperiment {
  return {
    id: 'e1',
    name: 'LinkedIn DM test',
    status: ExperimentStatus.DRAFT,
    metric: 'replies',
    endDate: null,
    outcomeCount: 0,
    learnings: [],
    strategyId: 's1',
    ...overrides,
  };
}

describe('setup gate', () => {
  // The first false step is the stage, in the order business, icp, goal,
  // research, strategy. Each case leaves everything before it satisfied.
  it.each([
    [{ hasBusiness: false }, 'BUSINESS', 'SET_UP_BUSINESS'],
    [{ icpCount: 0 }, 'ICP', 'DEFINE_ICP'],
    [{ openGoalCount: 0 }, 'GOAL', 'SET_GOAL'],
    [{ researchRunCount: 0 }, 'RESEARCH', 'RUN_RESEARCH'],
    [{ strategyCount: 0 }, 'STRATEGY', 'CHOOSE_STRATEGY'],
  ] as const)('%o resolves to %s', (patch, stage, kind) => {
    const state = resolveDashboardState(snapshot(patch));
    expect(state.stage).toBe(stage);
    expect(state.nextAction.kind).toBe(kind);
  });

  it('reports the earliest gap even when a later step is already done', () => {
    // A founder who set a goal before defining an ICP is still sent to the ICP.
    const state = resolveDashboardState(snapshot({ icpCount: 0, openGoalCount: 3 }));
    expect(state.stage).toBe('ICP');
  });

  it('counts only a research run that finished', () => {
    // A spec original contava run de qualquer status. Uma pesquisa que falhou
    // não gravou nada no contexto do negócio, então o check verde escondia o
    // erro — o repositório agora filtra por COMPLETED e este contador só
    // enxerga as que valeram.
    expect(setupFlags(snapshot({ researchRunCount: 1 })).research).toBe(true);
    expect(setupFlags(snapshot({ researchRunCount: 0 })).research).toBe(false);
  });

  it('reports progress as a count out of eight', () => {
    const flags = setupFlags(snapshot({ researchRunCount: 0, strategyCount: 0 }));
    expect(flags.completed).toBe(6);
    expect(flags.total).toBe(8);
    expect(isSetupComplete(snapshot({ strategyCount: 0 }))).toBe(false);
    expect(isSetupComplete(snapshot())).toBe(true);
  });

  it('leaves the rail empty while setup is incomplete', () => {
    expect(resolveDashboardState(snapshot({ hasBusiness: false })).rail).toEqual([]);
  });
});

describe('loop stages', () => {
  it('asks for an experiment when setup is done and none exists', () => {
    const state = resolveDashboardState(snapshot({ spine: null }));
    expect(state.stage).toBe('EXPERIMENT');
    expect(state.nextAction.kind).toBe('DESIGN_EXPERIMENT');
  });

  it.each([
    [ExperimentStatus.DRAFT, 'PLAN_EXPERIMENT'],
    [ExperimentStatus.PLANNED, 'APPROVE_EXPERIMENT'],
    [ExperimentStatus.APPROVED, 'START_EXPERIMENT'],
    [ExperimentStatus.PAUSED, 'RESUME_EXPERIMENT'],
  ] as const)('%s offers %s', (status, kind) => {
    const state = resolveDashboardState(snapshot({ spine: spine({ status }) }));
    expect(state.stage).toBe('RUN');
    expect(state.nextAction.kind).toBe(kind);
    expect(state.nextAction.experimentId).toBe('e1');
    expect(state.nextAction.subjectLabel).toBe('LinkedIn DM test');
  });

  it('waits while a running experiment has not reached its end date', () => {
    const endDate = new Date('2026-08-10T00:00:00Z');
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate }) }),
    );
    expect(state.nextAction.kind).toBe('WAIT_FOR_EXPERIMENT');
    expect(state.nextAction.endDate).toEqual(endDate);
  });

  it('waits when a running experiment has no end date at all', () => {
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate: null }) }),
    );
    expect(state.nextAction.kind).toBe('WAIT_FOR_EXPERIMENT');
    expect(state.nextAction.endDate).toBeNull();
  });

  it('asks to complete a running experiment once its end date has passed', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-07-27T00:00:00Z') }),
      }),
    );
    expect(state.nextAction.kind).toBe('COMPLETE_EXPERIMENT');
    // Only the ask changes; the stage is still RUN.
    expect(state.stage).toBe('RUN');
  });

  it('treats an end date exactly at now as reached', () => {
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate: NOW }) }),
    );
    expect(state.nextAction.kind).toBe('COMPLETE_EXPERIMENT');
  });
});

describe('after the experiment completes', () => {
  const completed = { status: ExperimentStatus.COMPLETED } as const;

  it('asks for an outcome first', () => {
    const state = resolveDashboardState(snapshot({ spine: spine({ ...completed, outcomeCount: 0 }) }));
    expect(state.stage).toBe('OUTCOME');
    expect(state.nextAction.kind).toBe('RECORD_OUTCOME');
  });

  it('asks for a learning once an outcome exists', () => {
    const state = resolveDashboardState(snapshot({ spine: spine({ ...completed, outcomeCount: 1 }) }));
    expect(state.stage).toBe('LEARN');
    expect(state.nextAction.kind).toBe('INTERPRET_OUTCOME');
  });

  it('asks to validate a candidate learning', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [{ id: 'l1', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-28T00:00:00Z') }],
        }),
      }),
    );
    expect(state.stage).toBe('VALIDATE');
    expect(state.nextAction.kind).toBe('VALIDATE_LEARNING');
    expect(state.nextAction.learningId).toBe('l1');
  });

  it('names the oldest candidate when several are waiting', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'newer', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-28T00:00:00Z') },
            { id: 'older', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-26T00:00:00Z') },
          ],
        }),
      }),
    );
    expect(state.nextAction.learningId).toBe('older');
  });

  it('closes the loop once a learning is validated', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'l1', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-27T00:00:00Z') },
            { id: 'l2', status: LearningStatus.VALIDATED, createdAt: new Date('2026-07-28T00:00:00Z') },
          ],
        }),
      }),
    );
    // Validated wins over a still-open candidate: the loop did produce a
    // learning, so the next move is the next loop.
    expect(state.stage).toBe('COMPLETE');
    expect(state.nextAction.kind).toBe('START_NEXT_LOOP');
  });

  it('sends a rejected-only candidate back to a fresh interpretation', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'l1', status: LearningStatus.REJECTED, createdAt: new Date('2026-07-27T00:00:00Z') },
            { id: 'l2', status: LearningStatus.ARCHIVED, createdAt: new Date('2026-07-28T00:00:00Z') },
          ],
        }),
      }),
    );
    expect(state.stage).toBe('LEARN');
    expect(state.nextAction.kind).toBe('INTERPRET_OUTCOME');
  });

  it('offers no kind the route map cannot place', () => {
    // The old manual-learning kind is gone; a stale reference would fail this.
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.COMPLETED, outcomeCount: 1 }) }),
    );
    expect(state.nextAction.kind).toBe('INTERPRET_OUTCOME');
  });
});

describe('rail', () => {
  it('marks strategy done and experiment current before an experiment exists', () => {
    expect(resolveDashboardState(snapshot({ spine: null })).rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'CURRENT' },
      { node: 'OUTCOME', state: 'TODO' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('keeps experiment current while it runs', () => {
    const rail = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING }) }),
    ).rail;
    expect(rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'CURRENT' },
      { node: 'OUTCOME', state: 'TODO' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('moves to outcome once the experiment completed', () => {
    const rail = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.COMPLETED }) }),
    ).rail;
    expect(rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'DONE' },
      { node: 'OUTCOME', state: 'CURRENT' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('marks every node done when the loop is complete', () => {
    const rail = resolveDashboardState(
      snapshot({
        spine: spine({
          status: ExperimentStatus.COMPLETED,
          outcomeCount: 2,
          learnings: [{ id: 'l1', status: LearningStatus.VALIDATED, createdAt: NOW }],
        }),
      }),
    ).rail;
    expect(rail.every((entry) => entry.state === 'DONE')).toBe(true);
  });
});

describe('every next action implies a legal experiment transition', () => {
  // Only these kinds assert that the experiment moved to a new status; a
  // kind not in this map is presumed to imply no transition at all (it is
  // about an outcome, a learning, or the next loop instead). The presumption
  // is pinned by NO_TRANSITION_KINDS below, and the per-status assertion
  // fails loudly if a kind shows up that is in neither map — which is what
  // catches a newly added transition-implying kind that nobody wired in here.
  const KIND_TARGET: Partial<Record<string, ExperimentStatus>> = {
    PLAN_EXPERIMENT: ExperimentStatus.PLANNED,
    APPROVE_EXPERIMENT: ExperimentStatus.APPROVED,
    START_EXPERIMENT: ExperimentStatus.RUNNING,
    RESUME_EXPERIMENT: ExperimentStatus.RUNNING,
    COMPLETE_EXPERIMENT: ExperimentStatus.COMPLETED,
  };

  // Kinds the stage machine can offer that name no experiment-status
  // transition at all — they are about recording an outcome, writing or
  // validating a learning, starting the next loop, or designing the very
  // first experiment.
  const NO_TRANSITION_KINDS = new Set([
    'WAIT_FOR_EXPERIMENT',
    'RECORD_OUTCOME',
    'INTERPRET_OUTCOME',
    'VALIDATE_LEARNING',
    'START_NEXT_LOOP',
    'DESIGN_EXPERIMENT',
  ]);

  // Non-terminal per TRANSITIONS itself (an empty target list means
  // terminal), rather than a second hand-written list that could drift from
  // the real transition table.
  //
  // Final whole-branch review, flagged and adjudicated deferred: because
  // TRANSITIONS[COMPLETED] is empty, COMPLETED is filtered out of this list —
  // so the it.each below never runs resolveDashboardState against a COMPLETED
  // experiment, and therefore never exercises the kinds the LEARN stage
  // offers (INTERPRET_OUTCOME, RECORD_OUTCOME, VALIDATE_LEARNING,
  // START_NEXT_LOOP, COMPLETE_EXPERIMENT). NO_TRANSITION_KINDS' membership for
  // those is correct, but this loop is not what proves it; do not read the
  // green run above as coverage of the post-completion kinds. The three
  // explicit "after the experiment completes" tests elsewhere in this file
  // are what actually exercise them.
  const NON_TERMINAL_STATUSES = (Object.keys(TRANSITIONS) as ExperimentStatus[]).filter(
    (status) => TRANSITIONS[status].length > 0,
  );

  it.each(NON_TERMINAL_STATUSES)(
    'the next action offered for a %s experiment is a legal transition (or asserted to imply none)',
    (status) => {
      const state = resolveDashboardState(snapshot({ spine: spine({ status }) }));
      const kind = state.nextAction.kind;
      const target = KIND_TARGET[kind];

      if (target === undefined) {
        expect(
          NO_TRANSITION_KINDS.has(kind),
          `"${kind}" (offered for a ${status} experiment) is neither mapped to a target status nor an ` +
            'expected no-transition kind — extend KIND_TARGET or NO_TRANSITION_KINDS in this test',
        ).toBe(true);
        return;
      }

      expect(TRANSITIONS[status], `"${kind}" implies moving a ${status} experiment to ${target}`).toContain(target);
    },
  );
});

describe('a goal that exists but is not being pursued', () => {
  const DRAFT = { id: 'g1', name: 'Triplicar demos qualificadas' };

  it('keeps the goal step done and asks to activate it', () => {
    // Um rascunho conta como objetivo criado — quem acabou de criar não pode
    // ser mandado criar outro. Mas ele não é o número que a AUREA persegue.
    const state = resolveDashboardState(snapshot({ activeGoalCount: 0, draftGoal: DRAFT }));

    expect(state.stage).toBe('GOAL');
    expect(state.nextAction.kind).toBe('ACTIVATE_GOAL');
    expect(state.nextAction.subjectLabel).toBe(DRAFT.name);
  });

  it('names the draft rather than sending the founder to research it', () => {
    // Sem esta regra o vão seguinte seria RESEARCH, e pesquisar mercado para
    // um objetivo inativo é trabalho sem destino.
    const state = resolveDashboardState(
      snapshot({ activeGoalCount: 0, draftGoal: DRAFT, researchRunCount: 0 }),
    );

    expect(state.nextAction.kind).toBe('ACTIVATE_GOAL');
  });

  it('still asks for the earlier steps first', () => {
    // Sem negócio, ativar um objetivo não é o próximo passo de ninguém.
    const state = resolveDashboardState(
      snapshot({ hasBusiness: false, activeGoalCount: 0, draftGoal: DRAFT }),
    );

    expect(state.nextAction.kind).toBe('SET_UP_BUSINESS');
  });

  it('asks for a new goal when every one is closed', () => {
    // Pausados, concluídos e cancelados não deixam rascunho para ativar.
    const state = resolveDashboardState(
      snapshot({ openGoalCount: 0, activeGoalCount: 0, draftGoal: null }),
    );

    expect(state.nextAction.kind).toBe('SET_GOAL');
  });
});

describe('the eight-step gate', () => {
  it('reports the earliest incomplete step, with the three new ones in place', () => {
    // A ordem é a do funil: sem contexto não há ICP honesto, sem hipótese não
    // há experimento que teste alguma coisa.
    const cases = [
      [{ hasBusiness: false }, 'SET_UP_BUSINESS'],
      [{ contextSectionCount: 0 }, 'FILL_CONTEXT'],
      [{ icpCount: 0 }, 'DEFINE_ICP'],
      [{ openGoalCount: 0 }, 'SET_GOAL'],
      [{ researchRunCount: 0 }, 'RUN_RESEARCH'],
      [{ strategyCount: 0 }, 'CHOOSE_STRATEGY'],
      [{ hypothesisCount: 0 }, 'CREATE_HYPOTHESIS'],
      [{ experimentCount: 0 }, 'DESIGN_EXPERIMENT'],
    ] as const;

    for (const [patch, kind] of cases) {
      expect(resolveDashboardState(snapshot(patch)).nextAction.kind).toBe(kind);
    }
  });

  it('needs three filled context sections, not two', () => {
    // O mesmo número que o precheck do propose-icp exige antes de propor um
    // ICP. O guia não pode dizer "feito" enquanto o agente do passo seguinte
    // recusa por falta disso.
    expect(setupFlags(snapshot({ contextSectionCount: 2 })).context).toBe(false);
    expect(setupFlags(snapshot({ contextSectionCount: 3 })).context).toBe(true);
  });

  it('counts progress out of eight', () => {
    const flags = setupFlags(snapshot({ hypothesisCount: 0, experimentCount: 0 }));
    expect(flags.completed).toBe(6);
    expect(flags.total).toBe(8);
  });

  it('is not complete until an experiment exists', () => {
    // A mudança de significado mais silenciosa desta spec: quem lê esta função
    // pergunta "esse fundador passou do onboarding?", e a resposta agora
    // inclui ter o primeiro experimento.
    expect(isSetupComplete(snapshot({ experimentCount: 0 }))).toBe(false);
    expect(isSetupComplete(snapshot())).toBe(true);
  });
});
