import {
  buildRecent,
  isSetupComplete,
  resolveDashboardState,
  setupFlags,
} from '../dashboard.domain.js';
import type { DashboardRepository } from '../dashboard.repository.js';
import type { DashboardResponse } from '../dashboard.schema.js';

export type GetDashboardDeps = { repo: DashboardRepository };

export function getDashboardService(deps: GetDashboardDeps) {
  return async (input: { workspaceId: string; now: Date }): Promise<DashboardResponse> => {
    const snapshot = await deps.repo.snapshot(input.workspaceId, input.now);
    const { stage, nextAction, rail } = resolveDashboardState(snapshot);
    const setup = setupFlags(snapshot);

    // The feed is worth reading even mid-setup: a founder who ran research
    // yesterday should see it. The loop header is not — there is no loop.
    // A cobrança vale mesmo com o setup incompleto? Não: sem experimento não há
    // medição pendente, e a consulta devolve zero de graça. Fica no mesmo
    // Promise.all para não somar uma ida ao banco em série.
    const [recentSources, loopContext, pendingMeasurement] = await Promise.all([
      deps.repo.recentSources(input.workspaceId),
      isSetupComplete(snapshot) ? deps.repo.loopContext(input.workspaceId, snapshot.spine) : null,
      deps.repo.pendingMeasurement(input.workspaceId),
    ]);

    return {
      setup,
      stage,
      nextAction,
      loop: loopContext
        ? {
            number: loopContext.number,
            goal: loopContext.goal,
            strategy: loopContext.strategy,
            experiment: snapshot.spine
              ? {
                  id: snapshot.spine.id,
                  name: snapshot.spine.name,
                  status: snapshot.spine.status,
                  metric: snapshot.spine.metric,
                  endDate: snapshot.spine.endDate,
                }
              : null,
            rail,
          }
        : null,
      recent: buildRecent(recentSources),
      pendingMeasurement,
    };
  };
}
