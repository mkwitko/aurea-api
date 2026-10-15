// Crédito é preço ao cliente, não custo de token: um run que escala de tier
// gasta mais dinheiro e continua custando o mesmo crédito. A margem se defende
// no catálogo de planos, não por run.
//
// A âncora é esforço percebido: 1 crédito = uma ação pequena que o usuário
// reconhece; ação composta custa a soma das partes (9 seções = 9 créditos).
const CREDITS_BY_TASK: Record<string, number> = {
  'summarize-business-context': 1,
  'propose-strategies': 3,
  'research-growth-context': 5,
  // Uma chamada ao modelo sobre um experimento: entre o resumo (1) e a
  // proposta de estratégias (3) na âncora de esforço percebido.
  'interpret-outcome': 2,
  // Preenchimento assistido. Mesma âncora de esforço percebido: 1 crédito por
  // ação pequena que o usuário reconhece, composta custa a soma das partes.
  // O perfil sai de uma leitura do site (2); o contexto inteiro é sete seções
  // com busca na web, e fica ao lado da pesquisa (5); uma seção só, sem busca,
  // relendo o que já está gravado, é a ação mínima (1).
  'propose-business-profile': 2,
  'propose-business-context': 5,
  'propose-context-section': 1,
  'propose-icp': 1,
  'propose-goal': 1,
  'propose-hypothesis': 1,
  'propose-experiment': 2,
  // Uma leitura do experimento, uma da property, uma resposta curta: a mesma
  // âncora de esforço percebido dos outros preenchimentos de um campo.
  'propose-metric-binding': 1,
  // Uma leitura de aprendizados, opcionalmente uma do experimento, um texto
  // curto: a mesma âncora de esforço percebido dos outros preenchimentos de um
  // campo. Não faz parte dos "sete agentes de preenchimento" originais — é o
  // décimo, adicionado depois — mas o registro não tolera taskType sem preço
  // (`registry-coverage.test.ts`, "leave nothing in the registry unpriced").
  'propose-social-post': 1,
};

export class UnknownOperationCostError extends Error {
  constructor(taskType: string) {
    super(`No credit cost registered for task type: ${taskType}`);
    this.name = 'UnknownOperationCostError';
  }
}

export function creditCost(taskType: string): number {
  const cost = CREDITS_BY_TASK[taskType];
  // Custo zero silencioso para tarefa nova é run de graça em produção.
  if (cost === undefined) throw new UnknownOperationCostError(taskType);
  return cost;
}

export function operationCatalog(): { taskType: string; credits: number }[] {
  return Object.entries(CREDITS_BY_TASK).map(([taskType, credits]) => ({ taskType, credits }));
}
