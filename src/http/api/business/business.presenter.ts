import type { BusinessContextVersion } from '@prisma/client';
import { calculateCompleteness, getIncompleteSections } from '../../../types/business-context.js';
import type { BusinessContextData } from './business-context-data.schema.js';
import type { SectionMeta } from './business.schema.js';

export function presentContextVersion(row: BusinessContextVersion) {
  const data = (row.data as BusinessContextData) ?? {};
  const completeness = calculateCompleteness(data);
  const incompleteSections = getIncompleteSections(data);
  // Nulo em toda versão anterior a este campo e em toda versão escrita por um
  // caminho que ainda não popula proveniência por seção (update-context,
  // context-from-research) — `{}` é o valor honesto para "nenhuma seção
  // carrega selo", não um erro de serialização.
  const sectionMeta = (row.meta as SectionMeta | null) ?? {};

  return {
    id: row.id,
    version: row.version,
    data,
    source: row.source,
    confidence: row.confidence,
    sourceAgentRunId: row.sourceAgentRunId,
    createdAt: row.createdAt,
    completeness,
    incompleteSections,
    sectionMeta,
  };
}
