import { describe, expect, it } from 'vitest';
import { ActionStatus } from '@prisma/client';
import { assertActionTransition, TRANSITIONS } from './actions.domain.js';

describe('assertActionTransition', () => {
  it('deixa o caminho feliz inteiro passar', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.PENDING_APPROVAL)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.APPROVED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.APPROVED, ActionStatus.EXECUTING)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.EXECUTING, ActionStatus.EXECUTED)).not.toThrow();
  });

  // Rejeitar devolve a Action ao autor com o comentário, e não a mata: o
  // fundador corrige o texto e submete de novo (spec §4.3).
  it('permite a rejeição voltar para PROPOSED', () => {
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.PROPOSED)).not.toThrow();
  });

  // Reexecutar uma falha é ato humano legítimo (spec §7.2).
  it('permite reexecutar de FAILED', () => {
    expect(() => assertActionTransition(ActionStatus.FAILED, ActionStatus.EXECUTING)).not.toThrow();
  });

  /**
   * Retentar de DELIVERY_UNKNOWN volta a ser ilegal na migração para a Post for
   * Me: ela não tem endpoint de retry, então não existe id que o provider
   * reconheça para retentar só o que falhou. Executar dali seria um segundo envio
   * às cegas, que duplica post público (spec de migração §2.5).
   */
  it('recusa retentar de DELIVERY_UNKNOWN', () => {
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.EXECUTING)).toThrow();
  });

  it('sai de DELIVERY_UNKNOWN para os desfechos, e nunca para FAILED', () => {
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.EXECUTED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.PARTIALLY_EXECUTED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.APPROVED)).not.toThrow();
    // Marcar falha o que talvez tenha publicado negaria um post público real.
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.FAILED)).toThrow();
  });

  // Cancelar o que talvez tenha publicado esconderia o fato.
  it('recusa cancelar uma entrega incerta', () => {
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.CANCELLED)).toThrow();
  });

  // Publicou em uma rede e falhou em outra: retentar atinge só as que faltam.
  it('permite retentar e cancelar de PARTIALLY_EXECUTED', () => {
    expect(() => assertActionTransition(ActionStatus.PARTIALLY_EXECUTED, ActionStatus.EXECUTING)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.PARTIALLY_EXECUTED, ActionStatus.CANCELLED)).not.toThrow();
  });

  it('EXECUTING alcança os quatro desfechos', () => {
    for (const to of [
      ActionStatus.EXECUTED,
      ActionStatus.PARTIALLY_EXECUTED,
      ActionStatus.FAILED,
      ActionStatus.DELIVERY_UNKNOWN,
    ]) {
      expect(() => assertActionTransition(ActionStatus.EXECUTING, to)).not.toThrow();
    }
  });

  it('recusa aprovar o que não foi submetido', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.APPROVED)).toThrow(
      /Cannot move action from PROPOSED to APPROVED/,
    );
  });

  // Executar sem aprovação é a coisa que este sistema existe para impedir.
  it('recusa executar direto de PROPOSED ou de PENDING_APPROVAL', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.EXECUTING)).toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.EXECUTING)).toThrow();
  });

  it('EXECUTED e CANCELLED são terminais', () => {
    expect(TRANSITIONS[ActionStatus.EXECUTED]).toEqual([]);
    expect(TRANSITIONS[ActionStatus.CANCELLED]).toEqual([]);
  });

  // Uma Action executada não pode ser cancelada: cancelar não despublica nada,
  // e o status mentiria sobre o que existe no mundo.
  it('recusa cancelar depois de executado', () => {
    expect(() => assertActionTransition(ActionStatus.EXECUTED, ActionStatus.CANCELLED)).toThrow();
  });

  it('cancela de qualquer estado pré-execução', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.APPROVED, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.FAILED, ActionStatus.CANCELLED)).not.toThrow();
  });

  // A tabela cobre o enum inteiro: um status novo sem aresta declarada estoura
  // aqui, e não em produção com `TRANSITIONS[status]` undefined.
  it('tem uma entrada por status do enum', () => {
    for (const status of Object.values(ActionStatus)) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });
});
