import { describe, expect, it } from 'vitest';
import { parseGrantArgs } from './grant-credits.js';

describe('parseGrantArgs', () => {
  it('parses a full invocation', () => {
    expect(parseGrantArgs(['--workspace', 'ws-1', '--credits', '500', '--reason', 'support credit'])).toEqual({
      workspaceId: 'ws-1',
      credits: 500,
      reason: 'support credit',
    });
  });

  it('refuses a non-positive amount', () => {
    expect(() => parseGrantArgs(['--workspace', 'ws-1', '--credits', '0', '--reason', 'x'])).toThrow();
  });

  it('demands a reason, because the ledger is the audit trail', () => {
    expect(() => parseGrantArgs(['--workspace', 'ws-1', '--credits', '10'])).toThrow(/reason/i);
  });

  // O complemento de troca de plano do B2b conta o que o mês já recebeu por
  // `reason LIKE 'plan change%'`. Um grant manual com esse prefixo entra na conta
  // e reduz em silêncio um complemento legítimo posterior — o cliente sobe de
  // plano e recebe menos crédito do que pagou.
  it('refuses the reason prefix reserved for the plan-change top-up', () => {
    expect(() =>
      parseGrantArgs(['--workspace', 'ws-1', '--credits', '10', '--reason', 'plan change goodwill']),
    ).toThrow(/reserved/i);
  });

  it('refuses the reserved prefix whatever the case', () => {
    expect(() =>
      parseGrantArgs(['--workspace', 'ws-1', '--credits', '10', '--reason', 'Plan Change goodwill']),
    ).toThrow(/reserved/i);
  });

  it('still allows a reason that merely mentions a plan', () => {
    expect(
      parseGrantArgs(['--workspace', 'ws-1', '--credits', '10', '--reason', 'goodwill after plan change']).reason,
    ).toBe('goodwill after plan change');
  });
});
