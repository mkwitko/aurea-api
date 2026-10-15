import { describe, expect, it } from 'vitest';
import { isPackId, packCatalog, packCredits, packForPrice, priceForPack } from './credit-packs.js';

describe('credit packs', () => {
  it('grows credits with the pack', () => {
    expect(packCredits('SMALL')).toBe(100);
    expect(packCredits('MEDIUM')).toBeGreaterThan(packCredits('SMALL'));
    expect(packCredits('LARGE')).toBeGreaterThan(packCredits('MEDIUM'));
  });

  it('maps a configured price back to its pack', () => {
    expect(packForPrice('price_test_pack_medium')).toBe('MEDIUM');
    expect(packForPrice('price_test_plan_growth')).toBeNull();
  });

  it('resolves the price of a pack', () => {
    expect(priceForPack('LARGE')).toBe('price_test_pack_large');
  });

  it('recognises only the three pack ids', () => {
    expect(isPackId('SMALL')).toBe(true);
    expect(isPackId('HUGE')).toBe(false);
  });

  it('rejects prototype pollution attacks on pack id guard', () => {
    expect(isPackId('toString')).toBe(false);
    expect(isPackId('constructor')).toBe(false);
    expect(isPackId('__proto__')).toBe(false);
  });

  it('publishes the pack catalog with credits and price', () => {
    expect(packCatalog()).toEqual([
      { packId: 'SMALL', credits: 100, priceCents: 19_700, currency: 'BRL' },
      { packId: 'MEDIUM', credits: 500, priceCents: 79_700, currency: 'BRL' },
      { packId: 'LARGE', credits: 2_000, priceCents: 249_700, currency: 'BRL' },
    ]);
  });

  it('keeps the published credits equal to what a purchase grants', () => {
    for (const entry of packCatalog()) {
      expect(entry.credits).toBe(packCredits(entry.packId));
    }
  });
});
