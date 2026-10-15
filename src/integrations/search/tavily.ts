import { z } from 'zod';
import { type SearchProvider, type SearchResult, SearchProviderError } from './search-provider.js';

const ENDPOINT = 'https://api.tavily.com/search';
const MAX_RESULTS = 5;
// Cinco páginas inteiras no contexto custam mais do que a pesquisa inteira e
// empurram o run contra o teto de tokens. O corte é grande o bastante para
// sustentar uma citação e pequeno o bastante para caber cinco vezes. Com
// `chunks_per_source: 3` e no máximo 500 caracteres por chunk, três chunks
// somam exatamente esse teto — a truncagem agora limita um payload que já
// tem o formato certo, em vez de cortar a página no meio da barra de navegação.
const CONTENT_CHARS = 1500;

const responseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      raw_content: z.string().nullable().optional(),
    }),
  ),
});

export function createTavilyProvider(apiKey: string): SearchProvider {
  return {
    name: 'tavily',
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: MAX_RESULTS,
          // Advanced depth custa 2 créditos Tavily por busca em vez de 1, mas é
          // o que compra os chunks mais relevantes de cada página em vez do
          // trecho de SERP de `basic` — sem isso o agente citaria texto que
          // nunca leu.
          search_depth: 'advanced',
          chunks_per_source: 3,
          include_answer: false,
          include_raw_content: true,
          include_images: false,
        }),
        signal,
      });

      if (!response.ok) {
        throw new SearchProviderError(`tavily search failed with status ${response.status}`);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new SearchProviderError('tavily returned a response body that is not valid JSON');
      }

      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) {
        throw new SearchProviderError('tavily returned an unreadable response');
      }

      return parsed.data.results.slice(0, MAX_RESULTS).map((result) => ({
        title: result.title,
        url: result.url,
        // `raw_content` é o texto limpo da página; cai para `content` (o
        // trecho de SERP) quando Tavily não conseguiu parsear a página —
        // ainda assim um achado, não um vazio.
        content: (result.raw_content && result.raw_content.length > 0 ? result.raw_content : result.content).slice(
          0,
          CONTENT_CHARS,
        ),
      }));
    },
  };
}
