import type { Plan, SubscriptionStatus } from '@prisma/client';
import { env } from '../config/env.js';

// Franquia mensal por plano. Vive em código, não no banco, pela mesma razão do
// catálogo de modelos: mudar o que um plano dá é decisão de produto que passa
// por revisão, não UPDATE solto em produção.
//
// Calibrada por folga, não por custo: no preço do DeepSeek um mês inteiro de
// SCALE custa ~$24 de token contra ~$460 de receita. Quem estoura a franquia é
// quem deveria subir de plano.
const MONTHLY_CREDITS: Record<Plan, number> = {
  STARTER: 200,
  GROWTH: 1_000,
  SCALE: 4_000,
};

// Franquia multiplica por workspace: uma org GROWTH com 3 workspaces tem 3.000
// créditos/mês. O teto é o que segura a margem — sem ele um STARTER cria vinte
// workspaces e leva 4.000 créditos por R$297.
const MAX_WORKSPACES: Record<Plan, number> = {
  STARTER: 1,
  GROWTH: 3,
  SCALE: 10,
};

// Preço mensal em centavos de real, espelhando o Price do Stripe apontado por
// STRIPE_PRICE_*. Mudar preço é mudar em dois lugares (dashboard do Stripe e
// aqui); o teste do catálogo é o que lembra disso. A alternativa — ler do
// Stripe a cada request — põe rede numa rota que é constante por deploy.
const PRICE_CENTS: Record<Plan, number> = {
  STARTER: 29_700,
  GROWTH: 99_700,
  SCALE: 249_700,
};

const CURRENCY = 'BRL';

export type PlanCatalogEntry = {
  plan: Plan;
  monthlyCredits: number;
  maxWorkspaces: number;
  priceCents: number;
  currency: string;
};

const PLAN_ORDER: Plan[] = ['STARTER', 'GROWTH', 'SCALE'];

// O front precisa comparar planos, e comparar exige os números dos três — não
// só do plano corrente que GET /billing devolve. Publicar o catálogo aqui evita
// a mesma tabela escrita à mão no front, divergindo sem quebrar nada.
export function planCatalog(): PlanCatalogEntry[] {
  return PLAN_ORDER.map((plan) => ({
    plan,
    monthlyCredits: MONTHLY_CREDITS[plan],
    maxWorkspaces: MAX_WORKSPACES[plan],
    priceCents: PRICE_CENTS[plan],
    currency: CURRENCY,
  }));
}

// Crédito de boas-vindas. É GRANT e não franquia porque franquia renovaria todo
// mês para sempre; o lançamento no ledger é o registro de que já foi concedido.
export const TRIAL_CREDITS = 50;

export function monthlyAllowance(plan: Plan): number {
  return MONTHLY_CREDITS[plan];
}

export function maxWorkspaces(plan: Plan): number {
  return MAX_WORKSPACES[plan];
}

// PAST_DUE mantém a franquia: o Stripe recobra por ~2 semanas, cartão vencido
// não é má-fé, e cortar no primeiro erro perde cliente bom. TRIAL e CANCELED
// recebem zero — quem não paga usa o GRANT de boas-vindas e o crédito comprado,
// que não é afetado por status nenhum.
export function effectiveAllowance(plan: Plan, status: SubscriptionStatus): number {
  return status === 'ACTIVE' || status === 'PAST_DUE' ? monthlyAllowance(plan) : 0;
}

function priceToPlan(): Record<string, Plan> {
  const map: Record<string, Plan> = {};
  if (env.STRIPE_PRICE_STARTER) map[env.STRIPE_PRICE_STARTER] = 'STARTER';
  if (env.STRIPE_PRICE_GROWTH) map[env.STRIPE_PRICE_GROWTH] = 'GROWTH';
  if (env.STRIPE_PRICE_SCALE) map[env.STRIPE_PRICE_SCALE] = 'SCALE';
  return map;
}

// Price desconhecido não vira plano: um evento com o price de outra conta ou de
// um produto que não é nosso não pode promover ninguém.
export function planForPrice(priceId: string): Plan | null {
  const map = priceToPlan();
  // Use hasOwnProperty to prevent prototype pollution from untrusted inputs
  // (e.g., Stripe webhook events carrying another account's price or metadata).
  if (Object.prototype.hasOwnProperty.call(map, priceId)) {
    return map[priceId] as Plan;
  }
  return null;
}
