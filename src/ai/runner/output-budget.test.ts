import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGENT_REGISTRY } from '../agents/registry.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  estimateWorstCaseOutputTokens,
  OUTPUT_TOKEN_CEILING,
} from './output-budget.js';

/**
 * O teto de saída que já rodou em produção sem o provider recusar o
 * `max_tokens` (os runs de propose-business-context). Um schema cujo pior caso
 * passa disto — três estratégias inteiras, doze produtos — não ganha um teto
 * inicial maior por decreto: a escalada do runner leva até
 * `OUTPUT_TOKEN_CEILING` quando a resposta de fato precisar.
 */
const PROVEN_START = 8192;

describe('estimateWorstCaseOutputTokens', () => {
  it('conta o teto de cada string, não o texto típico', () => {
    const small = estimateWorstCaseOutputTokens(z.object({ a: z.string().max(100) }));
    const big = estimateWorstCaseOutputTokens(z.object({ a: z.string().max(2000) }));

    expect(big).toBeGreaterThan(small * 5);
  });

  it('multiplica lista pelo número máximo de itens', () => {
    const one = estimateWorstCaseOutputTokens(z.object({ a: z.array(z.string().max(200)).max(1) }));
    const six = estimateWorstCaseOutputTokens(z.object({ a: z.array(z.string().max(200)).max(6) }));

    expect(six).toBeGreaterThan(one * 4);
  });

  it('assume um tamanho para string e lista sem teto — a conta não pode mentir por omissão', () => {
    expect(estimateWorstCaseOutputTokens(z.object({ a: z.string() }))).toBeGreaterThan(0);
    expect(estimateWorstCaseOutputTokens(z.object({ a: z.array(z.string()) }))).toBeGreaterThan(0);
  });

  it('enum vale o maior valor, não a soma dos ramos', () => {
    const withEnum = estimateWorstCaseOutputTokens(z.object({ a: z.enum(['low', 'medium', 'high']) }));

    expect(withEnum).toBeLessThan(estimateWorstCaseOutputTokens(z.object({ a: z.string().max(200) })));
  });

  it('estima o ICP que derrubou o run ebf8e706 acima do teto que ele tinha', () => {
    // Descrição de 2000 caracteres mais cinco listas de seis itens de 200: o
    // agente rodava com 2048 e o submit_answer saía cortado.
    const icpLike = z.object({
      name: z.string().max(160).optional(),
      description: z.string().max(2000).optional(),
      painPoints: z.array(z.string().max(200)).max(6).optional(),
      characteristics: z.array(z.string().max(200)).max(6).optional(),
      customerGoals: z.array(z.string().max(200)).max(6).optional(),
      buyingTriggers: z.array(z.string().max(200)).max(6).optional(),
      objections: z.array(z.string().max(200)).max(6).optional(),
    });

    expect(estimateWorstCaseOutputTokens(icpLike)).toBeGreaterThan(2048);
  });
});

describe('todo agente cabe o que o próprio schema aceita', () => {
  // A regra que faltava: `maxOutputTokens` era constante escolhida a dedo, e a
  // conta que a justificava vivia num comentário. Um campo novo no schema agora
  // reprova este teste em vez de sair cortando runs pagos em produção.
  for (const [taskType, agent] of Object.entries(AGENT_REGISTRY)) {
    it(`${taskType}`, () => {
      const estimate = estimateWorstCaseOutputTokens(agent.outputSchema);
      const budget = agent.budget?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

      expect(budget, `${taskType}: schema aceita ~${estimate} tokens, teto é ${budget}`).toBeGreaterThanOrEqual(
        Math.min(estimate, PROVEN_START),
      );
      // Teto inicial acima do que a escalada alcança seria um teto que nunca
      // pode crescer.
      expect(budget).toBeLessThanOrEqual(OUTPUT_TOKEN_CEILING);
    });
  }
});
