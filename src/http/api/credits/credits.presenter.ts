import type { CreditSummary } from '../../../billing/credit.service.js';
import type { LedgerRow } from '../../../billing/credit.repository.js';

export function presentCredits(summary: CreditSummary) {
  return {
    plan: summary.plan,
    allowance: summary.allowance,
    consumed: summary.consumed,
    purchasedBalance: summary.purchasedBalance,
    periodStart: summary.periodStart.toISOString(),
    periodEnd: summary.periodEnd.toISOString(),
  };
}

export function presentLedger(rows: LedgerRow[]) {
  return {
    entries: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      credits: row.credits,
      agentRunId: row.agentRunId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    // Cursor é o createdAt do último item: a próxima página pede `before` com ele.
    nextCursor: rows.length ? rows[rows.length - 1]!.createdAt.toISOString() : null,
  };
}
