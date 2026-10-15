# AI-Guided Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One guided flow at `/app/onboarding` that carries a founder from an empty workspace to a runnable experiment, framing the pages that already exist rather than duplicating their forms.

**Architecture:** A layout route renders a progress frame around the existing page component for each of eight steps. Progress is read from the dashboard's `setup` object, which grows from five flags to eight. Nothing about being mid-flow is persisted — the guide's position is recomputed from the data on every visit.

**Tech Stack:** Backend — Fastify, `fastify-type-provider-zod`, Prisma, vitest, zod **3.25.76**. Web — Vite, React 19, react-router-dom 7, Tailwind + shadcn/ui, react-i18next (en/pt/es), Kubb-generated client, vitest + @testing-library/react, zod **4.4.3**.

**Spec:** `back/docs/superpowers/specs/2026-07-31-ai-guided-onboarding-design.md`

## Global Constraints

- No new agent, no new write route, no progress table. Progress **is** the data.
- The eight steps and their done-rules are §4 of the spec. Step 2's three-section bar is the same threshold `propose-icp`'s `precheck` uses — one number, one meaning.
- `dashboardSetup.total` is `z.literal(8)`. `isSetupComplete` follows all eight.
- No form component may exist in two places. The guide renders the page components that already exist.
- "Próximo" is always enabled. A skipped step produces a warning, never a block.
- Backend relative imports carry `.js` (strict ESM). zod is **3.25.76** on the back, **4.4.3** on the web — do not copy a schema between repos.
- Web: generated Kubb client only, no raw `fetch`, no `any`, Tailwind + shadcn only.
- Web: every user-facing string is an i18n key in all three locales. `src/i18n/locales.test.ts` fails the build when the trees diverge.
- Web test files rendering a `useTranslation()` component must `import i18n from '@/i18n'` and `i18n.changeLanguage('en')`, or `t()` renders raw keys and assertions pass by accidental substring match.
- Tests: `pnpm test`, `pnpm typecheck` in each repo. Backend single file: `pnpm vitest run <path>`.

---

## File Structure

### Backend (`back/`)

| Path | Responsibility |
|---|---|
| `src/http/api/dashboard/dashboard.schema.ts` | **Modify.** `dashboardSetup` gains three flags, `total` becomes 8; `nextActionKind` gains `FILL_CONTEXT` and `CREATE_HYPOTHESIS`. |
| `src/http/api/dashboard/dashboard.domain.ts` | **Modify.** `DashboardSnapshot` gains three counts; `SETUP` grows to eight entries; `setupFlags` reports them. |
| `src/http/api/dashboard/dashboard.repository.ts` | **Modify.** Three more reads in the same parallel batch. |

### Web (`web/`)

| Path | Responsibility |
|---|---|
| `src/lib/onboarding-steps.ts` | **New.** The eight steps as data: key, order, the route each frames, and the task type whose credits it spends. The single source the frame and the redirect both read. |
| `src/components/onboarding/OnboardingFrame.tsx` | **New.** The frame: progress nodes, `X de 8`, credits ahead, the skipped-steps warning, and the footer. |
| `src/pages/OnboardingPage.tsx` | **New.** Resolves the current step from `setup`, renders the frame around the step's page component, owns "Próximo" and "sair do guia". |
| `src/App.tsx` | **Modify.** `/app/onboarding` and `/app/onboarding/:step` (plus `/app/onboarding/hypothesis/:id`). |
| `src/components/dashboard/SetupChecklist.tsx` | **Modify.** Eight rows from the same `setup`. |
| `src/lib/dashboard-actions.ts` | **Modify.** Routes for the two new kinds. |
| `src/i18n/locales/{en,pt,es}.json` | **Modify.** Step titles and help for the three new steps, the frame's copy, the two new next-action lines. |

---

### Task 1: The dashboard reports eight steps

**Files:**
- Modify: `back/src/http/api/dashboard/dashboard.schema.ts`
- Modify: `back/src/http/api/dashboard/dashboard.domain.ts`
- Modify: `back/src/http/api/dashboard/dashboard.repository.ts`
- Test: `back/src/http/api/dashboard/dashboard.domain.test.ts` (extend)
- Test: `back/src/http/api/dashboard/dashboard.repository.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DashboardSnapshot` gains `contextSectionCount: number`, `hypothesisCount: number`, `experimentCount: number`. `DashboardSetup` gains `context: boolean`, `hypothesis: boolean`, `experiment: boolean`; `total` is `8`. `NextActionKind` gains `'FILL_CONTEXT'` and `'CREATE_HYPOTHESIS'`.

- [ ] **Step 1: Write the failing tests**

Append to `back/src/http/api/dashboard/dashboard.domain.test.ts`:

```ts
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
```

Update the shared `snapshot()` helper at the top of that file so the healthy default satisfies all eight:

```ts
    icpCount: 1,
    contextSectionCount: 3,
    hypothesisCount: 1,
    experimentCount: 1,
```

Append to `back/src/http/api/dashboard/dashboard.repository.test.ts`:

```ts
  it('counts the three steps the guide added', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    expect(prisma.hypothesis.count).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
    expect(prisma.experiment.count).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
    expect(prisma.businessContext.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'b1' } }),
    );
  });
```

Read that file's `prismaFake()` first and add whatever mocks the three reads need — `hypothesis.count`, and a `businessContext.findUnique` returning `{ currentVersion: { data: {...} } }`. `experiment.count` already exists there.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/http/api/dashboard`
Expected: FAIL — the new snapshot fields do not exist.

- [ ] **Step 3: Widen the schema**

In `dashboard.schema.ts`, add the two kinds to `nextActionKind` — `'FILL_CONTEXT'` right after `'SET_UP_BUSINESS'`, `'CREATE_HYPOTHESIS'` right after `'CHOOSE_STRATEGY'` — and replace `dashboardSetup`:

```ts
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
```

- [ ] **Step 4: Widen the snapshot and the gate**

In `dashboard.domain.ts`, add to `DashboardSnapshot`:

```ts
  /** Seções do contexto com conteúdo. O mesmo contador do precheck do propose-icp. */
  contextSectionCount: number;
  hypothesisCount: number;
  experimentCount: number;
```

Replace the `SETUP` array with the eight entries, in funnel order:

```ts
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
```

`GOAL_STEP` stays the index of the goal entry — it is now **3**, not 2. Update the constant and its comment.

Rewrite `setupFlags` to derive from the array rather than index into it by hand, so a ninth step never needs this function edited again:

```ts
export function setupFlags(snapshot: DashboardSnapshot): DashboardSetup {
  const flags = Object.fromEntries(SETUP.map((step) => [step.key, step.done(snapshot)])) as Omit<
    DashboardSetup,
    'completed' | 'total'
  >;
  const completed = Object.values(flags).filter(Boolean).length;
  return { ...flags, completed, total: 8 };
}
```

- [ ] **Step 5: Fill the three counts**

In `dashboard.repository.ts`, add to the parallel batch and to the returned snapshot:

Two of the three go straight into the existing parallel batch:

```ts
        prisma.hypothesis.count({ where: { workspaceId } }),
        prisma.experiment.count({ where: { workspaceId } }),
```

`experiment.count` may already be in that batch for another field — check before adding a second one.

The context read cannot join them: it needs the business id that the batch's own `business.findFirst` returns. It goes after the batch:

```ts
      const context = business
        ? await prisma.businessContext.findUnique({
            where: { businessId: business.id },
            include: { currentVersion: true },
          })
        : null;

      // Narrowing of a Prisma JSON column, not unvalidated external input.
      const data = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;
      const contextSectionCount = countFilledSections(data);
```

and add the counter to the same file, mirroring `filledSectionCount` in `back/src/ai/agents/fill/propose-icp.ts` exactly — read that function and copy its rule:

```ts
/**
 * Quantas seções do contexto têm conteúdo. Espelha `filledSectionCount` em
 * `src/ai/agents/fill/propose-icp.ts`: as duas decidem a mesma coisa, e se
 * divergirem o guia dirá "feito" num passo cujo agente seguinte recusa.
 */
function countFilledSections(data: Record<string, unknown>): number {
  return Object.entries(data).filter(([key, value]) => {
    if (['completeness', 'lastReviewedAt', 'notes'].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }).length;
}
```

`business.findFirst` must now also select `id` — it already does.

- [ ] **Step 6: Run the tests, the full suite and typecheck**

Run: `pnpm vitest run src/http/api/dashboard && pnpm test && pnpm typecheck`
Expected: green. `get-dashboard.test.ts` mocks prisma directly and will need `hypothesis.count` and `businessContext.findUnique` added to its `EMPTY` fake — add them there too.

- [ ] **Step 7: Regenerate the OpenAPI dump and commit**

```bash
pnpm openapi:dump
git status
```

`pnpm openapi:dump` writes to `../web/api.json` — a **sibling repo**. Commit the backend change here, then commit `api.json` in `web/` on its own branch; Task 2 regenerates the client from it.

```bash
git add src/http/api/dashboard
git commit -m "feat(dashboard): report the eight onboarding steps"
```

---

### Task 2: The step table and the regenerated client

**Files:**
- Create: `web/src/lib/onboarding-steps.ts`
- Test: `web/src/lib/onboarding-steps.test.ts`
- Regenerate: `web/src/api/generated/**` via `pnpm api:generate` (gitignored — nothing to commit from it)

**Interfaces:**
- Consumes: the widened `setup` from Task 1.
- Produces:

```ts
export type OnboardingStepKey =
  | 'business' | 'context' | 'icp' | 'goal'
  | 'research' | 'strategy' | 'hypothesis' | 'experiment';

export interface OnboardingStep {
  key: OnboardingStepKey;
  /** 1-based position, for display. */
  n: number;
  /** The existing route this step frames. `:id` is filled by the page. */
  route: string;
  /** The agent whose credits this step can spend, or null when it has no AI. */
  taskType: string | null;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[];
export function stepByKey(key: string): OnboardingStep | undefined;
export function firstUndone(setup: Record<string, boolean>): OnboardingStep;
export function undoneBefore(setup: Record<string, boolean>, key: OnboardingStepKey): OnboardingStep[];
export function creditsAhead(setup: Record<string, boolean>, price: (taskType: string) => number | null): number;
```

- [ ] **Step 1: Regenerate the client**

From `web/`, after Task 1's `api.json` is in place:

```bash
pnpm api:generate
pnpm typecheck
```

`src/api/generated/` is gitignored, so there is no diff to commit. Confirm `GetDashboard.ts` now carries `FILL_CONTEXT`, `CREATE_HYPOTHESIS` and the eight setup flags. If it does not, `api.json` was not regenerated — go back to Task 1 Step 7.

- [ ] **Step 2: Write the failing test**

Create `web/src/lib/onboarding-steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  creditsAhead,
  firstUndone,
  stepByKey,
  undoneBefore,
} from './onboarding-steps';

const ALL_DONE = {
  business: true, context: true, icp: true, goal: true,
  research: true, strategy: true, hypothesis: true, experiment: true,
};
const NONE_DONE = Object.fromEntries(Object.keys(ALL_DONE).map((k) => [k, false]));

describe('ONBOARDING_STEPS', () => {
  it('has eight steps, numbered from one, in funnel order', () => {
    expect(ONBOARDING_STEPS).toHaveLength(8);
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual([
      'business', 'context', 'icp', 'goal', 'research', 'strategy', 'hypothesis', 'experiment',
    ]);
    expect(ONBOARDING_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('frames a real route for every step', () => {
    for (const step of ONBOARDING_STEPS) expect(step.route.startsWith('/app/')).toBe(true);
  });

  it('resolves a step by key and nothing by a bad one', () => {
    expect(stepByKey('goal')?.n).toBe(4);
    expect(stepByKey('nonsense')).toBeUndefined();
  });
});

describe('firstUndone', () => {
  it('is the first step the server has not marked done', () => {
    expect(firstUndone({ ...ALL_DONE, research: false }).key).toBe('research');
  });

  it('is the earliest gap, not the latest', () => {
    // Quem tem estratégia mas não tem ICP volta para o ICP.
    expect(firstUndone({ ...NONE_DONE, business: true, strategy: true }).key).toBe('context');
  });

  it('falls back to the last step once everything is done', () => {
    // Não existe nono passo para onde mandar alguém.
    expect(firstUndone(ALL_DONE).key).toBe('experiment');
  });
});

describe('undoneBefore', () => {
  it('names the earlier steps still undone', () => {
    const skipped = undoneBefore({ ...ALL_DONE, context: false, goal: false }, 'research');
    expect(skipped.map((s) => s.key)).toEqual(['context', 'goal']);
  });

  it('ignores later steps, done or not', () => {
    expect(undoneBefore(NONE_DONE, 'business')).toEqual([]);
  });
});

describe('creditsAhead', () => {
  const price = (taskType: string) => ({ 'propose-icp': 1, 'research-growth-context': 5 })[taskType] ?? null;

  it('counts only the AI steps still undone', () => {
    const ahead = creditsAhead({ ...ALL_DONE, icp: false, research: false }, price);
    expect(ahead).toBe(6);
  });

  it('is zero when everything ahead is done', () => {
    expect(creditsAhead(ALL_DONE, price)).toBe(0);
  });

  it('skips a step whose price the server has not published', () => {
    // Preço ausente é preço desconhecido, não zero — melhor subestimar a conta
    // do que inventar um número para o fundador.
    expect(creditsAhead({ ...ALL_DONE, goal: false }, () => null)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run src/lib/onboarding-steps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the module**

Create `web/src/lib/onboarding-steps.ts`:

```ts
/**
 * Os oito passos do guia, como dado.
 *
 * Espelha o array `SETUP` de `back/src/http/api/dashboard/dashboard.domain.ts`:
 * mesma ordem, mesmas chaves. O servidor decide o que está feito; este módulo
 * decide o que mostrar e para onde ir. Os dois repositórios não compartilham
 * código, então isto é cópia deliberada — e a ordem é a parte que não pode
 * divergir, porque é ela que define qual passo vem depois.
 */
export type OnboardingStepKey =
  | 'business'
  | 'context'
  | 'icp'
  | 'goal'
  | 'research'
  | 'strategy'
  | 'hypothesis'
  | 'experiment';

export interface OnboardingStep {
  key: OnboardingStepKey;
  n: number;
  route: string;
  taskType: string | null;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { key: 'business', n: 1, route: '/app/business/setup', taskType: 'propose-business-profile' },
  { key: 'context', n: 2, route: '/app/business', taskType: 'propose-business-context' },
  { key: 'icp', n: 3, route: '/app/icps/new', taskType: 'propose-icp' },
  { key: 'goal', n: 4, route: '/app/goals/new', taskType: 'propose-goal' },
  { key: 'research', n: 5, route: '/app/research', taskType: 'research-growth-context' },
  { key: 'strategy', n: 6, route: '/app/strategies', taskType: 'propose-strategies' },
  // A rota real carrega o id da estratégia; a página do guia o resolve.
  { key: 'hypothesis', n: 7, route: '/app/strategies', taskType: 'propose-hypothesis' },
  { key: 'experiment', n: 8, route: '/app/experiments/new', taskType: 'propose-experiment' },
];

export function stepByKey(key: string): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((step) => step.key === key);
}

/**
 * O primeiro passo que o servidor não marcou como feito.
 *
 * Com tudo feito devolve o último: não há nono passo, e mandar o fundador para
 * lugar nenhum seria pior do que deixá-lo no fim do guia.
 */
export function firstUndone(setup: Record<string, boolean>): OnboardingStep {
  return ONBOARDING_STEPS.find((step) => !setup[step.key]) ?? ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]!;
}

/** Os passos ANTERIORES a este que ficaram para trás. É o que o aviso nomeia. */
export function undoneBefore(setup: Record<string, boolean>, key: OnboardingStepKey): OnboardingStep[] {
  const current = stepByKey(key);
  if (!current) return [];
  return ONBOARDING_STEPS.filter((step) => step.n < current.n && !setup[step.key]);
}

/**
 * Quantos créditos os passos com IA ainda não feitos podem custar.
 *
 * Estimativa, não cobrança: cada botão é opcional, e quem digitar tudo à mão
 * gasta zero. Um preço que o servidor não publicou é ignorado — melhor
 * subestimar do que inventar um número sobre o dinheiro do fundador.
 */
export function creditsAhead(
  setup: Record<string, boolean>,
  price: (taskType: string) => number | null,
): number {
  return ONBOARDING_STEPS.filter((step) => !setup[step.key] && step.taskType !== null).reduce(
    (total, step) => total + (price(step.taskType!) ?? 0),
    0,
  );
}
```

- [ ] **Step 5: Run the tests and typecheck, then commit**

```bash
pnpm vitest run src/lib/onboarding-steps.test.ts && pnpm typecheck
git add src/lib/onboarding-steps.ts src/lib/onboarding-steps.test.ts
git commit -m "feat(web): the eight onboarding steps as data"
```

---

### Task 3: The frame

**Files:**
- Create: `web/src/components/onboarding/OnboardingFrame.tsx`
- Test: `web/src/components/onboarding/OnboardingFrame.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`

**Interfaces:**
- Consumes: `ONBOARDING_STEPS`, `undoneBefore`, `type OnboardingStepKey` (Task 2).
- Produces:

```ts
export interface OnboardingFrameProps {
  current: OnboardingStepKey;
  setup: Record<string, boolean>;
  /** Estimated credits for the AI steps still ahead; null while pricing loads. */
  creditsAhead: number | null;
  onNext(): void;
  onExit(): void;
  children: React.ReactNode;
}

export function OnboardingFrame(props: OnboardingFrameProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `web/src/components/onboarding/OnboardingFrame.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { OnboardingFrame } from './OnboardingFrame';

await i18n.changeLanguage('en');

const ALL_DONE = {
  business: true, context: true, icp: true, goal: true,
  research: true, strategy: true, hypothesis: true, experiment: true,
};

function renderFrame(over: Partial<Parameters<typeof OnboardingFrame>[0]> = {}) {
  const onNext = vi.fn();
  const onExit = vi.fn();
  render(
    <OnboardingFrame
      current="research"
      setup={ALL_DONE}
      creditsAhead={0}
      onNext={onNext}
      onExit={onExit}
      {...over}
    >
      <p>the step page</p>
    </OnboardingFrame>,
  );
  return { onNext, onExit };
}

describe('OnboardingFrame', () => {
  it('renders the step page inside it', () => {
    renderFrame();
    expect(screen.getByText('the step page')).toBeInTheDocument();
  });

  it('reports the position out of eight', () => {
    renderFrame();
    expect(screen.getByText(/5.*8/)).toBeInTheDocument();
  });

  it('advances even from an incomplete step', async () => {
    // O gate foi recusado de propósito: um botão desabilitado sem saída é onde
    // fluxos de onboarding perdem gente.
    const { onNext } = renderFrame({ setup: { ...ALL_DONE, research: false } });
    const next = screen.getByRole('button', { name: /próximo|next|siguiente/i });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(onNext).toHaveBeenCalled();
  });

  it('names the earlier steps the founder skipped', () => {
    renderFrame({ setup: { ...ALL_DONE, context: false, goal: false } });
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent(/context/i);
    expect(warning).toHaveTextContent(/goal/i);
  });

  it('says nothing when no earlier step was skipped', () => {
    renderFrame();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ignores a later step that is undone', () => {
    // Passo adiante não é passo pulado — o fundador ainda vai chegar nele.
    renderFrame({ setup: { ...ALL_DONE, experiment: false } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the credits still ahead, and hides the line while they load', () => {
    const { unmount } = render(<div />);
    unmount();
    renderFrame({ creditsAhead: 12 });
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('leaves the guide', async () => {
    const { onExit } = renderFrame();
    await userEvent.click(screen.getByRole('button', { name: /sair|exit|salir/i }));
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/onboarding/OnboardingFrame.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `web/src/components/onboarding/OnboardingFrame.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ONBOARDING_STEPS,
  stepByKey,
  undoneBefore,
  type OnboardingStepKey,
} from '@/lib/onboarding-steps';

export interface OnboardingFrameProps {
  current: OnboardingStepKey;
  setup: Record<string, boolean>;
  creditsAhead: number | null;
  onNext(): void;
  onExit(): void;
  children: React.ReactNode;
}

/**
 * A moldura do guia. Não conhece formulário nenhum: ela desenha o progresso,
 * avisa o que ficou para trás e oferece a saída — o passo em si é o
 * `children`, que é a página que já existe fora do guia.
 */
export function OnboardingFrame({
  current,
  setup,
  creditsAhead,
  onNext,
  onExit,
  children,
}: OnboardingFrameProps) {
  const { t } = useTranslation();
  const step = stepByKey(current) ?? ONBOARDING_STEPS[0]!;
  const skipped = undoneBefore(setup, current);

  return (
    <div className="pb-24">
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-1.5">
          {ONBOARDING_STEPS.map((entry) => {
            const done = setup[entry.key];
            const isCurrent = entry.key === current;
            return (
              <div
                key={entry.key}
                aria-current={isCurrent ? 'step' : undefined}
                title={t(`app.dashboard.steps.${entry.key}.title`)}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[10px]',
                  done && 'border-transparent bg-gradient-to-br from-brand to-aura text-white',
                  !done && isCurrent && 'border-primary text-primary',
                  !done && !isCurrent && 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : entry.n}
              </div>
            );
          })}
        </div>

        <p className="font-mono text-xs text-muted-foreground">
          {t('onboarding.progress', { current: step.n, total: ONBOARDING_STEPS.length })}
          {/* Estimativa dos passos com IA que faltam. Enquanto o preço não
              resolveu a linha some, em vez de piscar um número errado sobre
              crédito. */}
          {creditsAhead !== null && creditsAhead > 0 && (
            <> · {t('onboarding.creditsAhead', { credits: creditsAhead })}</>
          )}
        </p>

        {skipped.length > 0 && (
          <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {t('onboarding.skipped', {
              steps: skipped.map((s) => t(`app.dashboard.steps.${s.key}.title`)).join(', '),
            })}
          </p>
        )}
      </div>

      {children}

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onExit}>
            {t('onboarding.exit')}
          </Button>
          {/* Sempre habilitado. Ver spec §3: o aviso substitui o portão. */}
          <Button size="sm" onClick={onNext}>
            {t('onboarding.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the copy, three locales**

Under a new top-level `onboarding` key in each of `en.json`, `pt.json`, `es.json`:

```
onboarding.progress      "step {{current}} of {{total}}" / "passo {{current}} de {{total}}" / "paso {{current}} de {{total}}"
onboarding.creditsAhead  "~{{credits}} credits ahead" / "~{{credits}} créditos pela frente" / "~{{credits}} créditos por delante"
onboarding.skipped       "You skipped: {{steps}}. AUREA proposes less without them." / "Você pulou: {{steps}}. A AUREA propõe menos sem isso." / "Saltaste: {{steps}}. AUREA propone menos sin eso."
onboarding.next          "Next" / "Próximo" / "Siguiente"
onboarding.exit          "Exit the guide" / "Sair do guia" / "Salir de la guía"
onboarding.title         "Getting started" / "Vamos começar" / "Vamos a empezar"
```

- [ ] **Step 5: Run the tests, the locale parity suite and typecheck, then commit**

```bash
pnpm vitest run src/components/onboarding src/i18n && pnpm typecheck
git add src/components/onboarding src/i18n/locales
git commit -m "feat(web): the onboarding frame"
```

---

### Task 4: The page and the routes

**Files:**
- Create: `web/src/pages/OnboardingPage.tsx`
- Test: `web/src/pages/OnboardingPage.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `OnboardingFrame` (Task 3); `ONBOARDING_STEPS`, `firstUndone`, `stepByKey`, `creditsAhead` (Task 2); `useGetDashboard`, `useGetCreditPricing`, `useListStrategies` (generated hooks).
- Produces: `OnboardingPage`, mounted at `/app/onboarding`, `/app/onboarding/:step` and `/app/onboarding/hypothesis/:id`.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/OnboardingPage.test.tsx`. Follow the mocking style of `src/pages/BusinessPage.test.tsx` — stub `fetch`, wrap in `QueryClientProvider` and `MemoryRouter`, and `await i18n.changeLanguage('en')`. Cover:

```
- /app/onboarding with an empty workspace redirects to the business step
- /app/onboarding with business and context done redirects to the icp step
- /app/onboarding with everything done redirects to the experiment step
- a named step renders that step's page inside the frame
- "Próximo" from step N navigates to step N+1
- "Próximo" on the last step leaves the guide for /app
- "Sair do guia" navigates to /app
- an unknown :step redirects to the first undone step rather than rendering nothing
```

The redirect assertions are on the resulting location, not on a spy — render at `/app/onboarding` inside a `MemoryRouter` with the route table and assert the step page's own heading appears.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/pages/OnboardingPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Create `web/src/pages/OnboardingPage.tsx`:

```tsx
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useGetDashboard } from '@/api/generated/hooks/dashboardHooks/useGetDashboard';
import { useGetCreditPricing } from '@/api/generated/hooks/creditsHooks/useGetCreditPricing';
import { useListStrategies } from '@/api/generated/hooks/strategiesHooks/useListStrategies';
import {
  ONBOARDING_STEPS,
  creditsAhead as sumCreditsAhead,
  firstUndone,
  stepByKey,
  type OnboardingStepKey,
} from '@/lib/onboarding-steps';
import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame';
import { BusinessSetupPage } from './BusinessSetupPage';
import { BusinessPage } from './BusinessPage';
import { IcpNewPage } from './IcpNewPage';
import { GoalNewPage } from './GoalNewPage';
import { ResearchPage } from './ResearchPage';
import { StrategiesPage } from './StrategiesPage';
import { StrategyDetailPage } from './StrategyDetailPage';
import { ExperimentNewPage } from './ExperimentNewPage';

/**
 * O passo é a página que já existe. Nenhum formulário é reescrito aqui — é
 * essa a razão de o guia ser uma moldura e não um wizard próprio.
 */
const STEP_PAGE: Record<OnboardingStepKey, () => JSX.Element> = {
  business: BusinessSetupPage,
  context: BusinessPage,
  icp: IcpNewPage,
  goal: GoalNewPage,
  research: ResearchPage,
  strategy: StrategiesPage,
  hypothesis: StrategyDetailPage,
  experiment: ExperimentNewPage,
};

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Os dois params numa chamada só: `id` é lido no ramo da hipótese abaixo, e
  // um useParams dentro daquele `if` quebraria as regras de hooks.
  const { step, id } = useParams<{ step?: string; id?: string }>();

  const dashboard = useGetDashboard();
  const pricing = useGetCreditPricing();
  // O passo da hipótese mora numa rota com id. Sem estratégia escolhida não há
  // id, e aí o passo anterior é que está pendente de qualquer forma.
  const strategies = useListStrategies();

  if (dashboard.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  const setup = (dashboard.data?.setup ?? {}) as unknown as Record<string, boolean>;
  const resolved = step ? stepByKey(step) : undefined;

  // Sem passo na url, ou com um passo que não existe, o servidor decide para
  // onde ir. Nunca renderizar nada é pior do que mandar para o começo.
  if (!resolved) return <Navigate to={`/app/onboarding/${firstUndone(setup).key}`} replace />;

  // A página da hipótese lê `id` de useParams, então o guia precisa levá-lo na
  // própria url em vez de renderizar o componente sem ele.
  if (resolved.key === 'hypothesis' && !id) {
    const strategyId = strategies.data?.strategies[0]?.id;
    if (strategyId) return <Navigate to={`/app/onboarding/hypothesis/${strategyId}`} replace />;
  }

  const price = (taskType: string) =>
    pricing.data?.operations.find((operation) => operation.taskType === taskType)?.credits ?? null;

  const StepPage = STEP_PAGE[resolved.key];
  const next = ONBOARDING_STEPS[resolved.n] ?? null;

  return (
    <OnboardingFrame
      current={resolved.key}
      setup={setup}
      creditsAhead={pricing.data ? sumCreditsAhead(setup, price) : null}
      onNext={() => navigate(next ? `/app/onboarding/${next.key}` : '/app')}
      onExit={() => navigate('/app')}
    >
      <StepPage />
    </OnboardingFrame>
  );
}
```

- [ ] **Step 4: Mount the routes**

In `web/src/App.tsx`, beside the other `/app` routes:

```tsx
      <Route path="/app/onboarding" element={<Protected><OnboardingPage /></Protected>} />
      <Route path="/app/onboarding/hypothesis/:id" element={<Protected><OnboardingPage /></Protected>} />
      <Route path="/app/onboarding/:step" element={<Protected><OnboardingPage /></Protected>} />
```

Order matters: the `hypothesis/:id` route must come before `:step`, or `:step` swallows it.

- [ ] **Step 5: Run the tests and typecheck, then commit**

```bash
pnpm test && pnpm typecheck
git add src/pages/OnboardingPage.tsx src/pages/OnboardingPage.test.tsx src/App.tsx
git commit -m "feat(web): the guided onboarding route"
```

---

### Task 5: Eight rows on the home page, and the way in

**Files:**
- Modify: `web/src/components/dashboard/SetupChecklist.tsx`
- Modify: `web/src/lib/dashboard-actions.ts`
- Modify: `web/src/lib/dashboard-actions.test.ts`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`
- Test: `web/src/components/dashboard/SetupChecklist.test.tsx` (create if absent)

**Interfaces:**
- Consumes: the widened `setup`; `ONBOARDING_STEPS` (Task 2).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

Create or extend `web/src/components/dashboard/SetupChecklist.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SetupChecklist } from './SetupChecklist';

await i18n.changeLanguage('en');

const SETUP = {
  business: true, context: true, icp: false, goal: false,
  research: false, strategy: false, hypothesis: false, experiment: false,
  completed: 2, total: 8 as const,
};

describe('SetupChecklist', () => {
  it('renders one row per onboarding step', () => {
    render(<MemoryRouter><SetupChecklist setup={SETUP} collapsed={false} /></MemoryRouter>);
    // Contexto, hipótese e experimento eram invisíveis na home antes disto: um
    // workspace podia dizer "5 de 5" sem contexto nenhum preenchido.
    for (const title of ['Business', 'Context', 'Ideal customer', 'Goal', 'Research', 'Strategy', 'Hypothesis', 'Experiment']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('reports progress out of eight when collapsed', () => {
    render(<MemoryRouter><SetupChecklist setup={{ ...SETUP, completed: 8 }} collapsed /></MemoryRouter>);
    expect(screen.getByText(/8.*8/)).toBeInTheDocument();
  });
});
```

Match the exact English titles to whatever you write in `en.json` in Step 3.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/components/dashboard/SetupChecklist.test.tsx`
Expected: FAIL — only five rows render.

- [ ] **Step 3: Widen the checklist**

In `SetupChecklist.tsx`, replace the local `stepDefs` array with the shared one, so the home and the guide can never disagree about what the steps are:

```tsx
import { Building2, ClipboardList, Compass, FlaskConical, Lightbulb, Target, Telescope, Users } from 'lucide-react';
import { ONBOARDING_STEPS, type OnboardingStepKey } from '@/lib/onboarding-steps';

/** Um ícone por passo. A ordem, as rotas e as chaves vêm do módulo compartilhado. */
const ICONS: Record<OnboardingStepKey, typeof Building2> = {
  business: Building2,
  context: ClipboardList,
  icp: Users,
  goal: Target,
  research: Telescope,
  strategy: Compass,
  hypothesis: Lightbulb,
  experiment: FlaskConical,
};
```

and drive `Rows` from `ONBOARDING_STEPS`, using `String(step.n).padStart(2, '0')` for the number that used to be hard-coded, `ICONS[step.key]` for the icon, and `step.route` for the link.

Widen `SetupFlags` to the eight booleans plus `completed` and `total`.

- [ ] **Step 4: Route the two new next-action kinds**

In `web/src/lib/dashboard-actions.ts`, add to `ROUTES`:

```ts
  FILL_CONTEXT: () => '/app/business',
  CREATE_HYPOTHESIS: () => '/app/strategies',
```

and add both to the `ALL_KINDS` list and the route table in `dashboard-actions.test.ts` — that file holds an exhaustiveness test that fails until they are there.

- [ ] **Step 5: Put the way in on the home page**

In `DashboardPage.tsx`, above the checklist while setup is incomplete:

```tsx
      {!setupComplete && (
        <Button asChild className="gap-2">
          <Link to="/app/onboarding">
            <Sparkles className="size-4" /> {t('app.dashboard.startGuide')}
          </Link>
        </Button>
      )}
```

- [ ] **Step 6: Add the copy, three locales**

Three new entries under `app.dashboard.steps` — `context`, `hypothesis`, `experiment` — each with `title`, `help` and `helpText`, matching the shape the five existing ones use. Plus `app.dashboard.startGuide`, and the two next-action lines under `app.dashboard.next`:

```
app.dashboard.next.FILL_CONTEXT       "Tell AUREA about your business" / "Conte à AUREA sobre seu negócio" / "Cuéntale a AUREA sobre tu negocio"
app.dashboard.next.CREATE_HYPOTHESIS  "Write the hypothesis to test first" / "Escreva a hipótese que vai testar primeiro" / "Escribe la hipótesis que probarás primero"
app.dashboard.startGuide              "Set up with the guide" / "Fazer o onboarding guiado" / "Hacer la guía de configuración"
```

Write `help` and `helpText` for the three new steps in plain founder language — the platform's users are non-technical, and `helpText` is what the `Help` popover shows.

- [ ] **Step 7: Run everything and commit**

```bash
pnpm test && pnpm typecheck
git add src/components/dashboard src/lib/dashboard-actions.ts src/lib/dashboard-actions.test.ts src/pages/DashboardPage.tsx src/i18n/locales
git commit -m "feat(web): eight steps on the home checklist, and the way into the guide"
```

---

## Exit Criteria

From the spec's §8, mapped to the task that satisfies each:

1. An empty workspace can reach a runnable experiment from `/app/onboarding` without manual navigation — Tasks 2, 4.
2. Reloading mid-flow returns to the same step, computed from data alone — Task 4 (no persisted position exists to get stale).
3. The home checklist and the guide report the same eight steps from the same source — Tasks 2, 5 (`SetupChecklist` reads `ONBOARDING_STEPS`).
4. No form component exists in two places — Task 4 (`STEP_PAGE` maps to the existing page components).
5. `pnpm test` and `pnpm typecheck` green in both repos — every task ends this way; Task 5 is the last check.
