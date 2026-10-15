import { describe, expect, it } from 'vitest';
import { Plan } from '@prisma/client';
import {
  monthlyAllowance,
  effectiveAllowance,
  maxWorkspaces,
  planForPrice,
  TRIAL_CREDITS,
  planCatalog,
} from './plan-catalog.js';

describe('monthlyAllowance', () => {
  it('gives every plan an allowance', () => {
    for (const plan of Object.values(Plan)) {
      expect(monthlyAllowance(plan)).toBeGreaterThan(0);
    }
  });

  it('grows with the plan', () => {
    expect(monthlyAllowance('GROWTH')).toBeGreaterThan(monthlyAllowance('STARTER'));
    expect(monthlyAllowance('SCALE')).toBeGreaterThan(monthlyAllowance('GROWTH'));
  });
});

describe('effectiveAllowance', () => {
  it('pays the plan allowance while the subscription is active', () => {
    expect(effectiveAllowance('GROWTH', 'ACTIVE')).toBe(monthlyAllowance('GROWTH'));
  });

  it('keeps the allowance during past_due, the window Stripe retries in', () => {
    expect(effectiveAllowance('GROWTH', 'PAST_DUE')).toBe(monthlyAllowance('GROWTH'));
  });

  it('gives nothing to trial and canceled', () => {
    expect(effectiveAllowance('GROWTH', 'TRIAL')).toBe(0);
    expect(effectiveAllowance('SCALE', 'CANCELED')).toBe(0);
  });
});

describe('maxWorkspaces', () => {
  it('caps every plan and grows with it', () => {
    expect(maxWorkspaces('STARTER')).toBe(1);
    expect(maxWorkspaces('GROWTH')).toBeGreaterThan(maxWorkspaces('STARTER'));
    expect(maxWorkspaces('SCALE')).toBeGreaterThan(maxWorkspaces('GROWTH'));
  });
});

describe('planForPrice', () => {
  it('maps a configured price to its plan', () => {
    expect(planForPrice('price_test_growth')).toBe('GROWTH');
  });

  it('refuses a price it does not know', () => {
    expect(planForPrice('price_someone_elses')).toBeNull();
  });

  it('rejects prototype pollution attacks on price lookup', () => {
    expect(planForPrice('constructor')).toBeNull();
    expect(planForPrice('toString')).toBeNull();
    expect(planForPrice('__proto__')).toBeNull();
  });
});

describe('TRIAL_CREDITS', () => {
  it('is a one-off grant, not an allowance', () => {
    expect(TRIAL_CREDITS).toBe(50);
  });
});

describe('plan catalog', () => {
  it('publishes the three plans in ascending order', () => {
    expect(planCatalog().map((e) => e.plan)).toEqual(['STARTER', 'GROWTH', 'SCALE']);
  });

  it('publishes the same credits and cap the rest of the system uses', () => {
    for (const entry of planCatalog()) {
      expect(entry.monthlyCredits).toBe(monthlyAllowance(entry.plan));
      expect(entry.maxWorkspaces).toBe(maxWorkspaces(entry.plan));
    }
  });

  it('publishes the price configured in Stripe, in cents', () => {
    expect(planCatalog()).toEqual([
      { plan: 'STARTER', monthlyCredits: 200, maxWorkspaces: 1, priceCents: 29_700, currency: 'BRL' },
      { plan: 'GROWTH', monthlyCredits: 1_000, maxWorkspaces: 3, priceCents: 99_700, currency: 'BRL' },
      { plan: 'SCALE', monthlyCredits: 4_000, maxWorkspaces: 10, priceCents: 249_700, currency: 'BRL' },
    ]);
  });

  it('charges more for more credits', () => {
    const [starter, growth, scale] = planCatalog();
    expect(growth!.priceCents).toBeGreaterThan(starter!.priceCents);
    expect(scale!.priceCents).toBeGreaterThan(growth!.priceCents);
  });
});
