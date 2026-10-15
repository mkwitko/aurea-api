import type { ResearchFinding, ResearchOpportunity } from '../../../ai/agents/research-growth-context.js';

type ContextData = Record<string, unknown>;
type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

// O dado gravado é Json e pode ter sido escrito por uma versão anterior do
// schema, então nada aqui pode assumir forma: cada leitura confere o tipo e
// cai num vazio seguro quando não bate.
//
// Dado já corrompido (marketContext gravado como string, um número dentro de
// um array que deveria ser só de strings) é descartado aqui, e essa perda é
// definitiva — não é logada nem preservada em outro campo. Filtrar o que já
// veio errado é a resposta certa para uma função pura, e logar quebraria a
// pureza que este arquivo foi separado para ter. Não é descuido, é decisão.
function objectAt(data: ContextData, key: string): ContextData {
  const value = data[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as ContextData) } : {};
}

function stringsAt(section: ContextData, key: string): string[] {
  const value = section[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

const normalize = (value: string): string => value.trim().toLowerCase();

// Idempotência por valor: aceitar de novo o mesmo achado não pode duplicar
// nada. É por isso que o aceite não precisa de índice único — a carga é um
// conjunto de seleções, não uma linha.
function appendUnique(existing: string[], additions: string[]): string[] {
  const seen = new Set(existing.map(normalize));
  const fresh = additions.filter((value) => {
    const key = normalize(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return fresh.length ? [...existing, ...fresh] : existing;
}

const TARGET_FIELD: Record<'TREND' | 'THREAT', string> = {
  TREND: 'trends',
  THREAT: 'threats',
};

export function applyResearchToContext(
  current: ContextData,
  selection: { findings: ResearchFinding[]; opportunities: ResearchOpportunity[] },
): ContextData {
  // Clone profundo: o retorno vira a próxima versão canônica do contexto do
  // negócio, e uma cópia rasa deixaria todo campo que esta função não toca
  // (ou toca só quando há achado do tipo certo) apontando para o mesmo objeto
  // que o chamador ainda guarda. Escrever no resultado corromperia o dado que
  // o chamador acha que está intacto. O dado é Json — objetos, arrays e
  // primitivos simples — então structuredClone é a resposta honesta.
  const next: ContextData = structuredClone(current);

  const marketAdditions: Record<string, string[]> = { trends: [], threats: [], opportunities: [] };
  for (const finding of selection.findings) {
    if (finding.target === 'TREND' || finding.target === 'THREAT') {
      marketAdditions[TARGET_FIELD[finding.target]]!.push(finding.statement);
    }
  }
  for (const opportunity of selection.opportunities) {
    marketAdditions.opportunities!.push(opportunity.statement);
  }

  if (Object.values(marketAdditions).some((list) => list.length > 0)) {
    const market = objectAt(next, 'marketContext');
    for (const [field, additions] of Object.entries(marketAdditions)) {
      if (!additions.length) continue;
      market[field] = appendUnique(stringsAt(market, field), additions);
    }
    next.marketContext = market;
  }

  const competitors = selection.findings.flatMap((finding) =>
    finding.target === 'COMPETITOR' && finding.competitor ? [finding.competitor] : [],
  );

  if (competitors.length) {
    const landscape = objectAt(next, 'competitiveLandscape');
    const existing = Array.isArray(landscape.competitors) ? [...(landscape.competitors as unknown[])] : [];
    const known = new Set(
      existing.flatMap((entry) => {
        const name = (entry as { name?: unknown }).name;
        return typeof name === 'string' ? [normalize(name)] : [];
      }),
    );

    for (const competitor of competitors) {
      if (known.has(normalize(competitor.name))) continue;
      known.add(normalize(competitor.name));
      existing.push(competitor);
    }

    landscape.competitors = existing;
    next.competitiveLandscape = landscape;
  }

  return next;
}

/**
 * Onde cada achado aterrissa, ou null quando não aterrissa em lugar nenhum.
 * Uma função só, usada tanto para escrever quanto para responder "isso já
 * está guardado?" e "tire isso de lá" — três respostas que precisam concordar,
 * e concordam por serem a mesma regra.
 */
function findingLanding(finding: ResearchFinding): { kind: 'market'; field: string; value: string } | { kind: 'competitor'; value: string } | null {
  if (finding.target === 'TREND' || finding.target === 'THREAT') {
    return { kind: 'market', field: TARGET_FIELD[finding.target], value: finding.statement };
  }
  // O schema do agente garante competitor presente exatamente quando o target
  // é COMPETITOR, mas o dado vem de um run já gravado: um output escrito por
  // uma versão anterior do schema não é obrigado a cumprir o de hoje.
  if (finding.target === 'COMPETITOR' && finding.competitor) {
    return { kind: 'competitor', value: finding.competitor.name };
  }
  return null;
}

function competitorNames(data: ContextData): Set<string> {
  const landscape = objectAt(data, 'competitiveLandscape');
  const list = Array.isArray(landscape.competitors) ? landscape.competitors : [];
  return new Set(
    list.flatMap((entry) => {
      const name = (entry as { name?: unknown } | null)?.name;
      return typeof name === 'string' ? [normalize(name)] : [];
    }),
  );
}

export type ResearchPresence = { findings: boolean[]; opportunities: boolean[] };

/**
 * Quais achados e oportunidades deste run já estão no contexto atual, por
 * índice. É o que faz a tela de pesquisa sobreviver a um F5: a marca "já está
 * guardado" passa a ser um fato do contexto, não uma lembrança da aba aberta.
 *
 * A comparação é a mesma do append (valor normalizado), então "presente" aqui
 * significa exatamente "o append não escreveria nada" — que é a definição que
 * o aceite precisa para não fingir uma gravação.
 */
export function researchPresence(
  current: ContextData,
  output: { findings: ResearchFinding[]; opportunities: ResearchOpportunity[] },
): ResearchPresence {
  const market = objectAt(current, 'marketContext');
  const names = competitorNames(current);
  const inMarket = (field: string, value: string) => stringsAt(market, field).some((item) => normalize(item) === normalize(value));

  return {
    findings: output.findings.map((finding) => {
      const landing = findingLanding(finding);
      // Um achado NONE não tem onde estar, então nunca está: prometer o
      // contrário faria a tela oferecer "remover" sobre nada.
      if (!landing) return false;
      return landing.kind === 'market' ? inMarket(landing.field, landing.value) : names.has(normalize(landing.value));
    }),
    opportunities: output.opportunities.map((opportunity) => inMarket('opportunities', opportunity.statement)),
  };
}

/**
 * O inverso do append: tira do contexto os valores que estes achados haviam
 * colocado lá. Simétrico de propósito — o fundador que guardou por engano
 * desfaz pelo mesmo caminho, e a versão anterior continua existindo.
 *
 * Compara por valor normalizado, igual ao append, então remove o que aquele
 * append teria evitado duplicar: mesmo texto com outra caixa alta sai.
 */
export function removeResearchFromContext(
  current: ContextData,
  selection: { findings: ResearchFinding[]; opportunities: ResearchOpportunity[] },
): ContextData {
  const next: ContextData = structuredClone(current);

  const marketDrops: Record<string, Set<string>> = { trends: new Set(), threats: new Set(), opportunities: new Set() };
  const competitorDrops = new Set<string>();

  for (const finding of selection.findings) {
    const landing = findingLanding(finding);
    if (!landing) continue;
    if (landing.kind === 'market') marketDrops[landing.field]!.add(normalize(landing.value));
    else competitorDrops.add(normalize(landing.value));
  }
  for (const opportunity of selection.opportunities) {
    marketDrops.opportunities!.add(normalize(opportunity.statement));
  }

  if (Object.values(marketDrops).some((drops) => drops.size > 0)) {
    const market = objectAt(next, 'marketContext');
    let touched = false;
    for (const [field, drops] of Object.entries(marketDrops)) {
      if (!drops.size) continue;
      // Só escreve o campo que existia: criar `trends: []` ao remover de um
      // contexto que nunca teve trends inventaria uma resposta vazia onde
      // antes havia silêncio, e a completude leria isso como preenchido. Pela
      // mesma razão a própria seção só é escrita se algum campo dela mudou.
      if (!Array.isArray(market[field])) continue;
      market[field] = stringsAt(market, field).filter((item) => !drops.has(normalize(item)));
      touched = true;
    }
    if (touched) next.marketContext = market;
  }

  if (competitorDrops.size) {
    const landscape = objectAt(next, 'competitiveLandscape');
    if (Array.isArray(landscape.competitors)) {
      landscape.competitors = landscape.competitors.filter((entry) => {
        const name = (entry as { name?: unknown } | null)?.name;
        // Entrada sem nome legível não casa com nenhuma remoção pedida, então
        // fica: apagar o que não se consegue identificar é perda de dado do
        // fundador por engano nosso.
        return typeof name !== 'string' || !competitorDrops.has(normalize(name));
      });
      next.competitiveLandscape = landscape;
    }
  }

  return next;
}

const ORDER: Confidence[] = ['LOW', 'MEDIUM', 'HIGH'];

// MEDIUM é ao mesmo tempo a resposta para seleção vazia e um teto: uma versão
// montada só com achados HIGH ainda sai MEDIUM. Uma versão vinda de saída de
// modelo não é mais confiável que o padrão que um humano recebe.
export function lowestConfidence(items: { confidence: Confidence }[]): Confidence {
  return items.reduce<Confidence>(
    (lowest, item) => (ORDER.indexOf(item.confidence) < ORDER.indexOf(lowest) ? item.confidence : lowest),
    'MEDIUM',
  );
}
