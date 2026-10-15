import type { ProposedOption } from '../../../../ai/agents/propose-strategies.js';

/** O rascunho de estratégia que uma adoção grava — antes ou depois da edição do fundador. */
export type StrategyDraft = {
  name: string;
  strategicThesis: string;
  growthMechanism: string;
  expectedOutcome: string;
  channels: string[];
  assumptions: string[];
  risks: string[];
  hypotheses: ProposedOption['hypotheses'];
};

/** Corta no limite da coluna sem cortar palavra no meio, e diz que cortou. */
function cap(value: string, max: number): string {
  if (value.length <= max) return value;
  const hard = value.slice(0, max - 1);
  const space = hard.lastIndexOf(' ');
  return `${(space > max * 0.6 ? hard.slice(0, space) : hard).trimEnd()}…`;
}

/** Une listas preservando a ordem e descartando repetição por valor normalizado. */
function union(lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of lists.flat()) {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/**
 * Funde as opções escolhidas num único plano.
 *
 * Isto é a semente, não a decisão: a tela mostra o resultado num formulário
 * editável e é o texto revisado que chega no aceite. Existe no servidor de todo
 * modo porque o caminho sem edição (aceitar como veio) não pode depender do
 * browser para dizer o que o agente propôs.
 *
 * Uma opção só passa por aqui inalterada — fundir uma coisa com nada é ela
 * mesma, e é o caminho antigo de aceitar uma proposta.
 *
 * Textos são unidos com o nome da opção na frente de cada bloco, porque um plano
 * combinado sem dizer de onde cada parágrafo veio é um texto que ninguém
 * consegue auditar depois. Listas viram união sem repetição: dois planos que
 * citam "Email" não geram dois canais Email.
 */
export function mergeProposedOptions(options: ProposedOption[]): StrategyDraft {
  const first = options[0];
  if (!first) throw new Error('mergeProposedOptions needs at least one option');
  if (options.length === 1) {
    return {
      name: first.name,
      strategicThesis: first.strategicThesis,
      growthMechanism: first.growthMechanism,
      expectedOutcome: first.expectedOutcome,
      channels: first.channels,
      assumptions: first.assumptions,
      risks: first.risks,
      hypotheses: first.hypotheses,
    };
  }

  const block = (pick: (option: ProposedOption) => string) =>
    options.map((option) => `${option.name}: ${pick(option)}`).join('\n\n');

  return {
    // Os limites são os da coluna (Strategy.name é 200, tese 2000, e assim por
    // diante em create-strategy.schema): fundir três opções longas passa deles,
    // e um corte silencioso no banco seria pior que um corte visível aqui, que o
    // fundador vê no formulário e reescreve se quiser.
    name: cap(options.map((option) => option.name).join(' + '), 200),
    strategicThesis: cap(block((option) => option.strategicThesis), 2000),
    // Mecanismo é um nome curto, não um texto: juntar dois com " + " ainda é
    // legível, e é a resposta honesta para um plano que usa dois.
    growthMechanism: cap(union(options.map((option) => [option.growthMechanism])).join(' + '), 160),
    expectedOutcome: cap(block((option) => option.expectedOutcome), 1000),
    channels: union(options.map((option) => option.channels)),
    assumptions: union(options.map((option) => option.assumptions)),
    risks: union(options.map((option) => option.risks)),
    // Toda hipótese das opções escolhidas entra: é o que o fundador vai testar,
    // e descartar em silêncio a hipótese de uma das opções combinadas esvaziaria
    // metade do plano que ele acabou de montar.
    hypotheses: options.flatMap((option) => option.hypotheses),
  };
}
