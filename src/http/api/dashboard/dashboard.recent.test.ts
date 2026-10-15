import { describe, expect, it } from 'vitest';
import { buildRecent, type RecentSources } from './dashboard.domain.js';

function sources(overrides: Partial<RecentSources> = {}): RecentSources {
  return {
    goals: [],
    researchRuns: [],
    strategies: [],
    experiments: [],
    outcomes: [],
    learnings: [],
    ...overrides,
  };
}

describe('buildRecent', () => {
  it('is empty for a workspace with nothing in it', () => {
    expect(buildRecent(sources())).toEqual([]);
  });

  it('maps a goal to GOAL_SET carrying its own name', () => {
    const items = buildRecent(
      sources({ goals: [{ id: 'g1', name: '30 trial signups/mo', createdAt: new Date('2026-07-19T00:00:00Z') }] }),
    );
    expect(items).toEqual([
      {
        at: new Date('2026-07-19T00:00:00Z'),
        kind: 'GOAL_SET',
        refType: 'GOAL',
        refId: 'g1',
        label: '30 trial signups/mo',
        count: null,
        value: null,
        unit: null,
      },
    ]);
  });

  it('counts the findings on a completed research run', () => {
    const items = buildRecent(
      sources({
        researchRuns: [
          {
            id: 'r1',
            completedAt: new Date('2026-07-20T00:00:00Z'),
            output: { findings: [{}, {}, {}, {}, {}, {}] },
          },
        ],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'RESEARCH_COMPLETED', refType: 'AGENT_RUN', refId: 'r1', count: 6 });
  });

  it('survives a research run whose output is not the shape it expects', () => {
    // AgentRun.output is Json: a refused or half-written run can hold
    // anything. A dashboard is not the place to 500 over it.
    const items = buildRecent(
      sources({
        researchRuns: [
          { id: 'r1', completedAt: new Date('2026-07-20T00:00:00Z'), output: null },
          { id: 'r2', completedAt: new Date('2026-07-21T00:00:00Z'), output: { findings: 'nope' } },
          { id: 'r3', completedAt: new Date('2026-07-22T00:00:00Z'), output: 'a string' },
        ],
      }),
    );
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.count === null)).toBe(true);
  });

  it('skips a research run that never completed', () => {
    expect(buildRecent(sources({ researchRuns: [{ id: 'r1', completedAt: null, output: null }] }))).toEqual([]);
  });

  it('separates an agent-proposed strategy from a hand-written one', () => {
    const items = buildRecent(
      sources({
        strategies: [
          {
            id: 's1',
            name: 'founder-led outbound',
            createdAt: new Date('2026-07-22T00:00:00Z'),
            sourceAgentRunId: 'run-9',
          },
          { id: 's2', name: 'SEO', createdAt: new Date('2026-07-21T00:00:00Z'), sourceAgentRunId: null },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['STRATEGY_ACCEPTED', 'STRATEGY_CREATED']);
  });

  it('emits both creation and completion for one experiment', () => {
    const items = buildRecent(
      sources({
        experiments: [
          {
            id: 'e1',
            name: 'LinkedIn DM test',
            createdAt: new Date('2026-07-24T00:00:00Z'),
            completedAt: new Date('2026-07-27T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['EXPERIMENT_COMPLETED', 'EXPERIMENT_CREATED']);
  });

  it('carries an outcome value and unit through, labelled by its metric', () => {
    const items = buildRecent(
      sources({
        outcomes: [
          {
            id: 'o1',
            metric: 'replies',
            value: 18,
            unit: 'replies',
            observedAt: new Date('2026-07-27T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'OUTCOME_RECORDED', label: 'replies', value: 18, unit: 'replies' });
  });

  it('emits both creation and validation for one learning', () => {
    const items = buildRecent(
      sources({
        learnings: [
          {
            id: 'l1',
            title: 'personalization beats volume',
            createdAt: new Date('2026-07-28T00:00:00Z'),
            validatedAt: new Date('2026-07-29T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['LEARNING_VALIDATED', 'LEARNING_CREATED']);
  });

  it('sorts every source together, newest first', () => {
    const items = buildRecent(
      sources({
        goals: [{ id: 'g1', name: 'goal', createdAt: new Date('2026-07-19T00:00:00Z') }],
        learnings: [{ id: 'l1', title: 'learning', createdAt: new Date('2026-07-28T00:00:00Z'), validatedAt: null }],
        outcomes: [{ id: 'o1', metric: 'replies', value: 18, unit: null, observedAt: new Date('2026-07-27T00:00:00Z') }],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['LEARNING_CREATED', 'OUTCOME_RECORDED', 'GOAL_SET']);
  });

  it('caps the feed at eight items, keeping the newest', () => {
    const goals = Array.from({ length: 12 }, (_, index) => ({
      id: `g${index}`,
      name: `goal ${index}`,
      // index 11 is the newest.
      createdAt: new Date(Date.UTC(2026, 6, index + 1)),
    }));
    const items = buildRecent(sources({ goals }));
    expect(items).toHaveLength(8);
    expect(items[0]!.refId).toBe('g11');
    expect(items[7]!.refId).toBe('g4');
  });
});
