import { env } from '../config/env.js';
import { BillingNotConfiguredError } from '../lib/errors.js';

const PACK_CREDITS = {
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 2_000,
} as const;

export type PackId = keyof typeof PACK_CREDITS;

// Centavos de real, espelhando os Prices de pacote no Stripe. Mesma razão e
// mesmo cuidado do preço de plano em plan-catalog.ts.
const PACK_PRICE_CENTS: Record<PackId, number> = {
  SMALL: 19_700,
  MEDIUM: 79_700,
  LARGE: 249_700,
};

const CURRENCY = 'BRL';

export type PackCatalogEntry = {
  packId: PackId;
  credits: number;
  priceCents: number;
  currency: string;
};

const PACK_ORDER: PackId[] = ['SMALL', 'MEDIUM', 'LARGE'];

export function packCatalog(): PackCatalogEntry[] {
  return PACK_ORDER.map((packId) => ({
    packId,
    credits: PACK_CREDITS[packId],
    priceCents: PACK_PRICE_CENTS[packId],
    currency: CURRENCY,
  }));
}

export function isPackId(value: string): value is PackId {
  // Use hasOwnProperty instead of `in` operator to prevent prototype pollution
  // from untrusted inputs (e.g., webhook metadata).
  return Object.prototype.hasOwnProperty.call(PACK_CREDITS, value);
}

export function packCredits(id: PackId): number {
  return PACK_CREDITS[id];
}

function packToPrice(): Record<PackId, string | undefined> {
  return {
    SMALL: env.STRIPE_PRICE_PACK_SMALL,
    MEDIUM: env.STRIPE_PRICE_PACK_MEDIUM,
    LARGE: env.STRIPE_PRICE_PACK_LARGE,
  };
}

export function packForPrice(priceId: string): PackId | null {
  const entries = Object.entries(packToPrice()) as [PackId, string | undefined][];
  return entries.find(([, price]) => price === priceId)?.[0] ?? null;
}

// Pacote sem price configurado é erro de operação, não do cliente pedindo errado:
// o id dele veio de um enum, não há nada que ele possa corrigir. Mesma causa e
// mesmo erro do plano sem price — BILLING_NOT_CONFIGURED, spec §9. Culpar o
// cliente com 400 UNKNOWN_CREDIT_PACK mandava o operador procurar no lugar errado.
export function priceForPack(id: PackId): string {
  const price = packToPrice()[id];
  if (!price) throw new BillingNotConfiguredError();
  return price;
}
