import { randomUUID } from 'node:crypto';
import type { ConfidenceLevel, ContextSource, Prisma, PrismaClient } from '@prisma/client';
import { createBusinessRepository } from '../../../http/api/business/business.repository.js';
import type { SectionMetaEntry } from '../../../http/api/business/business.schema.js';
import { contextFilledSchema } from './context-sections.js';
import type { ProposeContextOutput } from './propose-business-context.js';

// O dado gravado é Json e pode ter sido escrito por uma versão anterior do
// schema (ou por um caminho que nunca populou `meta`), então nada aqui pode
// assumir forma — mesmo raciocínio de business/research-context.ts.
type ContextData = Record<string, unknown>;
type SectionMetaData = Record<string, SectionMetaEntry>;

/**
 * As seis chaves que `filled` pode carregar (ver contextFilledSchema em
 * context-sections.ts). Derivado do próprio schema, e não copiado à mão, para
 * que uma seção adicionada ali um dia entre aqui sem precisar de uma segunda
 * edição que alguém esqueceria.
 */
const FILLED_SECTION_KEYS = Object.keys(contextFilledSchema.shape) as (keyof typeof contextFilledSchema.shape)[];

/**
 * "Tem conteúdo" para uma seção cujo `data` é Json solto: string não-vazia,
 * array não-vazio, ou objeto com pelo menos um campo não-vazio. Serve à regra
 * defensiva de não sobrescrever uma seção preenchida por um humano ANTES de
 * `meta` existir — sem histórico de proveniência, a única evidência de que
 * "alguém já respondeu isto" é a seção não estar vazia.
 */
function isEmptySectionValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isEmptySectionValue);
  return false;
}

/**
 * `id` é gerado pelo cliente antes do setValue no formulário (ver o
 * comentário de `productFilled` em context-sections.ts) — o modelo nunca o
 * propõe. Aplicar direto ao Growth Brain é o único caminho de escrita que não
 * passa por aquele formulário, então é aqui que o id nasce.
 */
function withGeneratedIds(products: unknown): unknown {
  if (!Array.isArray(products)) return products;
  return products.map((product) =>
    product && typeof product === 'object' ? { id: randomUUID(), ...(product as Record<string, unknown>) } : product,
  );
}

/**
 * `applyOutput` de propose-business-context (ver AgentDefinition.applyOutput
 * em ai/agents/registry.ts): roda dentro do runner, depois que `output` já
 * passou pelo outputSchema, e cria a BusinessContextVersion que antes só o
 * fundador criava — colhendo cada seção de AgentRun.output à mão.
 *
 * `output.filled` é mesclado SEÇÃO A SEÇÃO sobre `currentVersion.data`, na
 * mesma granularidade que update-section.service.ts já usa para escrita
 * humana: cada seção é substituída inteira, nunca campo a campo dentro dela.
 * A regra que decide QUAIS seções entram é a única coisa nova — nunca
 * sobrescrever uma seção cujo `meta` diga uma fonte diferente de AI, e,
 * defensivamente, nunca sobrescrever uma seção sem `meta` mas que já tem
 * conteúdo (contexto escrito antes deste campo existir).
 */
export async function applyProposedBusinessContext(
  output: ProposeContextOutput,
  ctx: { prisma: PrismaClient; workspaceId: string; runId: string },
): Promise<void> {
  // Idempotência: o BullMQ pode reprocessar um job cujo run já terminou com
  // sucesso (o worker morre entre o commit desta escrita e o ack da fila, por
  // exemplo). runId é o id do AgentRun — globalmente único — então a segunda
  // passada encontra a versão que a primeira já gravou e para aqui, sem
  // duplicar a escrita nem aplicar o output uma segunda vez.
  const alreadyApplied = await ctx.prisma.businessContextVersion.findFirst({
    where: { sourceAgentRunId: ctx.runId },
    select: { id: true },
  });
  if (alreadyApplied) return;

  const repo = createBusinessRepository(ctx.prisma);
  const business = await repo.getByWorkspace(ctx.workspaceId);
  // O negócio pode ter sido apagado entre o precheck (que já confirmou que
  // existia, antes de cobrar o crédito) e o fim do run. Nada de falhar o run
  // por isso — o resultado só não tem mais onde pousar.
  if (!business) return;

  const context = await repo.getContext(business.id);
  const currentData = (context?.currentVersion?.data as ContextData | null) ?? {};
  const currentMeta = (context?.currentVersion?.meta as SectionMetaData | null) ?? {};

  const nextData: ContextData = { ...currentData };
  const nextMeta: SectionMetaData = { ...currentMeta };
  let changed = false;

  for (const field of FILLED_SECTION_KEYS) {
    const proposed = output.filled[field];
    if (proposed === undefined) continue;

    const existingMeta = currentMeta[field];
    const ownedByUser = existingMeta ? existingMeta.source !== 'AI' : !isEmptySectionValue(currentData[field]);
    if (ownedByUser) continue;

    nextData[field] = field === 'products' ? withGeneratedIds(proposed) : proposed;
    nextMeta[field] = { source: 'AI', sourceAgentRunId: ctx.runId, confidence: output.confidence };
    changed = true;
  }

  // Nada elegível para aplicar (tudo já era do usuário, ou o modelo só trouxe
  // perguntas) não é erro: é uma proposta legítima que não tinha onde
  // escrever. Gravar uma versão idêntica à atual poluiria o histórico sem
  // mudar nada — mesmo raciocínio de createFromResearchService (ver
  // context-from-research.service.ts).
  if (!changed) return;

  await repo.addContextVersion(business.id, {
    data: nextData as Prisma.InputJsonValue,
    meta: nextMeta as Prisma.InputJsonValue,
    source: 'AI' as ContextSource,
    confidence: output.confidence as ConfidenceLevel,
    sourceAgentRunId: ctx.runId,
  });
}
