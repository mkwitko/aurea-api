import { getModelForTier } from '../ai/model-router/router.js';
import { createDeepSeekProvider } from '../ai/providers/openai-compatible.js';

// Uma completion mínima contra o provider real. Barata (1 token de saída) e rara
// (só na gravação), e evita guardar uma chave que só falharia horas depois.
export async function verifyProviderKey(provider: string, apiKey: string): Promise<boolean> {
  if (provider !== 'deepseek') return false;

  try {
    await createDeepSeekProvider(apiKey).complete({
      modelId: getModelForTier('TIER1').modelId,
      messages: [{ role: 'user', content: 'ping' }],
      jsonMode: false,
      maxTokens: 1,
      signal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch {
    return false;
  }
}
