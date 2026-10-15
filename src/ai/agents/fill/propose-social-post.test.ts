import { describe, expect, it, vi } from 'vitest';
import { proposeSocialPostAgent } from './propose-social-post.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'ADMIN' as const };

const EXPERIMENT_ID = '44444444-4444-4444-4444-444444444444';

const CONNECTED = ['LINKEDIN', 'X'] as const;

describe('proposeSocialPostAgent', () => {
  it('aceita um input sem experimento', () => {
    expect(proposeSocialPostAgent.inputSchema.safeParse({ connected: CONNECTED }).success).toBe(true);
  });

  it('aceita brief e experimento', () => {
    const parsed = proposeSocialPostAgent.inputSchema.safeParse({
      connected: CONNECTED,
      experimentId: EXPERIMENT_ID,
      brief: 'Falar do corte de custo, sem número inventado.',
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * Sem a lista de redes conectadas, o modelo escolheria entre todas — e sugeriria
   * uma rede onde publicar falharia, fazendo o fundador achar que dá.
   */
  it('recusa um input sem as redes conectadas', () => {
    expect(proposeSocialPostAgent.inputSchema.safeParse({ brief: 'qualquer coisa' }).success).toBe(false);
    expect(proposeSocialPostAgent.inputSchema.safeParse({ connected: [] }).success).toBe(false);
  });

  // Instagram e TikTok exigem mídia e estão fora do enum: pedir por elas é input
  // inválido, não uma sugestão que nunca publicaria.
  it('recusa uma rede que a AUREA não publica', () => {
    expect(proposeSocialPostAgent.inputSchema.safeParse({ connected: ['INSTAGRAM'] }).success).toBe(false);
  });

  it('recusa um experimentId que não é uuid', () => {
    expect(
      proposeSocialPostAgent.inputSchema.safeParse({ connected: CONNECTED, experimentId: 'nope' }).success,
    ).toBe(false);
  });

  it('aceita a saída do contrato de preenchimento', () => {
    const parsed = proposeSocialPostAgent.outputSchema.safeParse({
      filled: { name: 'Post sobre custo', payload: { content: 'Texto do post.' }, platforms: ['LINKEDIN'] },
      questions: [],
      confidence: 'MEDIUM',
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * O modelo sugere rede, nunca conta: não há conta para ele escolher, porque o
   * provider tem uma por rede. Um campo de canal na saída seria o modelo
   * decidindo em qual conta publicar.
   */
  it('recusa uma saída que tenta escolher a conta', () => {
    const parsed = proposeSocialPostAgent.outputSchema.safeParse({
      filled: { payload: { content: 'Texto.', channelId: 'chan-9' } },
      questions: [],
      confidence: 'HIGH',
    });
    expect(parsed.success).toBe(false);
  });

  it('recusa uma saída com rede fora do vocabulário', () => {
    const parsed = proposeSocialPostAgent.outputSchema.safeParse({
      filled: { platforms: ['REDDIT'] },
      questions: [],
      confidence: 'HIGH',
    });
    expect(parsed.success).toBe(false);
  });

  it('só lê aprendizados quando não há experimento', () => {
    const tools = proposeSocialPostAgent.buildTools({ connected: [...CONNECTED] });

    expect(tools.map((tool) => tool.name)).toEqual(['get_learnings']);
  });

  it('lê o experimento também quando ele existe', () => {
    const tools = proposeSocialPostAgent.buildTools({
      connected: [...CONNECTED],
      experimentId: EXPERIMENT_ID,
    });

    expect(tools.map((tool) => tool.name)).toContain('get_experiment_result');
  });

  it('põe as redes conectadas e o brief na conversa', () => {
    const messages = proposeSocialPostAgent.buildMessages(
      { connected: [...CONNECTED], brief: 'Tom sóbrio.' },
      { tenant: TENANT },
    );

    const text = messages.map((message) => message.content).join('\n');
    expect(text).toContain('LINKEDIN');
    expect(text).toContain('X');
    expect(text).toContain('Tom sóbrio.');
  });

  // Dizer isso explicitamente evita o modelo inventar um experimento para
  // justificar o texto.
  it('diz na conversa quando não há experimento', () => {
    const messages = proposeSocialPostAgent.buildMessages({ connected: [...CONNECTED] }, { tenant: TENANT });

    expect(messages.map((message) => message.content).join('\n')).toContain('not tied to an experiment');
  });

  // Recusar aqui é recusar antes de cobrar o crédito — é para isso que o
  // precheck existe.
  it('recusa no precheck um experimento de outro workspace', async () => {
    const prisma = { experiment: { findFirst: vi.fn().mockResolvedValue(null) } };

    await expect(
      proposeSocialPostAgent.precheck?.(
        { connected: [...CONNECTED], experimentId: EXPERIMENT_ID },
        { prisma: prisma as never, tenant: TENANT },
      ),
    ).rejects.toMatchObject({ code: 'AUR-T0005' });
  });

  it('não consulta o banco quando não há experimento', async () => {
    const prisma = { experiment: { findFirst: vi.fn() } };

    await proposeSocialPostAgent.precheck?.({ connected: [...CONNECTED] }, { prisma: prisma as never, tenant: TENANT });

    expect(prisma.experiment.findFirst).not.toHaveBeenCalled();
  });
});
