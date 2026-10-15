// O contrato existe separado da implementação porque o CLAUDE.md princípio 5
// pede independência de fornecedor: trocar Tavily por outro buscador não pode
// exigir tocar no agente nem na tool.
export type SearchResult = {
  title: string;
  url: string;
  /**
   * Texto já limpo da página (os chunks mais relevantes, não a página
   * inteira), não só o trecho do SERP. Cai para o trecho do SERP apenas
   * quando o provedor não conseguiu parsear a página.
   */
  content: string;
};

export interface SearchProvider {
  readonly name: string;
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
}

export class SearchProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderError';
  }
}
