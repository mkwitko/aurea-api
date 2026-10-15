import { describe, expect, it } from 'vitest';
import { proposeMetricBindingAgent } from './propose-metric-binding.js';
import { creditCost } from '../../../billing/operation-cost.js';

describe('propose-metric-binding', () => {
  it('custa um crédito, como os outros preenchimentos de um campo', () => {
    expect(creditCost(proposeMetricBindingAgent.taskType)).toBe(1);
  });

  it('pede as duas fontes de verdade antes de responder', () => {
    const tools = proposeMetricBindingAgent.buildTools({ experimentId: '11111111-1111-1111-1111-111111111111' });

    expect(tools.map((tool) => tool.name)).toEqual(['get_experiment_result', 'list_source_metrics']);
  });

  it('aceita uma proposta com métrica e filtro', () => {
    const parsed = proposeMetricBindingAgent.outputSchema.safeParse({
      binding: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
      rationale: 'A métrica do teste é cadastro concluído, e o evento sign_up é o que a property registra.',
    });

    expect(parsed.success).toBe(true);
  });

  it('aceita uma proposta sem filtro', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: { metric: 'sessions', dimensionFilter: null },
        rationale: 'Sessões do período, sem filtro.',
      }).success,
    ).toBe(true);
  });

  // A trava que mais importa: nenhuma métrica plausível é uma resposta, não uma
  // falha. Uma amarração errada não erra um campo — erra todos os números
  // daquele experimento para sempre, e chega disfarçada de dado.
  it('aceita "nenhuma serve" com o motivo, e exige o motivo', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: null,
        rationale: 'A property não tem nenhuma métrica de resposta a e-mail; isto se mede no provedor de e-mail.',
      }).success,
    ).toBe(true);

    expect(proposeMetricBindingAgent.outputSchema.safeParse({ binding: null }).success).toBe(false);
    expect(proposeMetricBindingAgent.outputSchema.safeParse({ binding: null, rationale: '' }).success).toBe(false);
  });

  it('recusa campo extra na amarração', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: { metric: 'conversions', propertyId: '999' },
        rationale: 'x',
      }).success,
    ).toBe(false);
  });
});
