import { maxWorkspaces } from '../../../billing/plan-catalog.js';
import type { OrgBilling } from '../../../billing/billing.repository.js';

export function presentBilling(org: OrgBilling, workspaceCount: number) {
  return {
    plan: org.plan,
    status: org.subscriptionStatus,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    // Diz só o que a coluna sabe dizer: existe uma assinatura registrada. NÃO é
    // "tem cartão" — o nome anterior (hasPaymentMethod) errava nos dois sentidos.
    // Quem só comprou pacote avulso tem cartão e lia false; quem cancelou
    // continua com stripeSubscriptionId preenchido (cancelSubscription só mexe no
    // status) e lia true para sempre. Para saber se há assinatura VÁLIDA, o
    // cliente cruza este campo com `status`.
    hasSubscription: org.stripeSubscriptionId !== null,
    maxWorkspaces: maxWorkspaces(org.plan),
    workspaceCount,
  };
}
