import type { ActionTargetStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { aggregateActionStatus, PUBLISHABLE_TARGET } from './actions.targets.js';

const t = (status: ActionTargetStatus) => ({ status });

describe('aggregateActionStatus', () => {
  it('sem alvo, não decide nada', () => {
    expect(aggregateActionStatus([])).toBeNull();
  });

  // Regra 1 antes de tudo: um alvo em voo mantém a ação em voo, mesmo que outro
  // já tenha publicado.
  it('algum PUBLISHING é EXECUTING', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('PUBLISHING')])).toBe('EXECUTING');
  });

  // A ação ainda não executou: o status dela é o do ciclo de aprovação, e
  // devolver algo aqui sobrescreveria PROPOSED/APPROVED com um status de entrega.
  it('todos PENDING não decide nada', () => {
    expect(aggregateActionStatus([t('PENDING'), t('PENDING')])).toBeNull();
  });

  it('todos PUBLISHED é EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('PUBLISHED')])).toBe('EXECUTED');
  });

  // O caso que existe para não mentir: dizer FAILED negaria um post público real,
  // e dizer EXECUTED esconderia a falha.
  it('publicado em um e falho em outro é PARTIALLY_EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('FAILED')])).toBe('PARTIALLY_EXECUTED');
  });

  it('publicado em um e incerto em outro é PARTIALLY_EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('DELIVERY_UNKNOWN')])).toBe('PARTIALLY_EXECUTED');
  });

  it('nada publicado e algo incerto é DELIVERY_UNKNOWN', () => {
    expect(aggregateActionStatus([t('FAILED'), t('DELIVERY_UNKNOWN')])).toBe('DELIVERY_UNKNOWN');
  });

  // O caminho de volta: o humano disse que o incerto não publicou, o alvo virou
  // PENDING, e a ação fica executável de novo.
  it('nada publicado e algo PENDING volta para APPROVED', () => {
    expect(aggregateActionStatus([t('FAILED'), t('PENDING')])).toBe('APPROVED');
  });

  it('todos FAILED é FAILED', () => {
    expect(aggregateActionStatus([t('FAILED'), t('FAILED')])).toBe('FAILED');
  });
});

describe('PUBLISHABLE_TARGET', () => {
  // A lista que impede o post duplicado: um alvo publicado tem post no mundo, e
  // um incerto pode ter. Nenhum dos dois entra numa chamada nossa de publicação.
  it('é só PENDING e FAILED', () => {
    expect(PUBLISHABLE_TARGET).toEqual(['PENDING', 'FAILED']);
    expect(PUBLISHABLE_TARGET).not.toContain('PUBLISHED');
    expect(PUBLISHABLE_TARGET).not.toContain('DELIVERY_UNKNOWN');
    expect(PUBLISHABLE_TARGET).not.toContain('PUBLISHING');
  });
});
