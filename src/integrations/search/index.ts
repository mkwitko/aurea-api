import { env } from '../../config/env.js';
import { createTavilyProvider } from './tavily.js';
import { type SearchProvider, SearchProviderError } from './search-provider.js';

export { SearchProviderError } from './search-provider.js';
export type { SearchProvider, SearchResult } from './search-provider.js';

// O único ponto onde env encontra busca. Quem chama pergunta se está
// configurado antes de cobrar créditos (create-agent-run) — este `throw` é a
// segunda linha de defesa, dentro do worker.
export function isSearchConfigured(): boolean {
  return env.TAVILY_API_KEY !== undefined;
}

export function createSearchProviderFromEnv(): SearchProvider {
  if (!env.TAVILY_API_KEY) throw new SearchProviderError('search provider is not configured');
  return createTavilyProvider(env.TAVILY_API_KEY);
}
