import { createGa4Provider, minterFor, serviceAccountEmail } from '../../../integrations/analytics/index.js';
import type { VerifyIntegration } from './integrations.service.js';

/** Dez segundos: é uma chamada de metadata, não um relatório. */
const TIMEOUT_MS = 10_000;

/**
 * Uma leitura real contra a fonte, barata e rara (só na gravação). Espelha
 * `billing/verify-provider-key.ts`, e pela mesma razão.
 */
export const verifyIntegration: VerifyIntegration = async (input) => {
  if (input.provider !== 'GA4' || input.authKind !== 'SERVICE_ACCOUNT') {
    return { ok: false, reason: `unsupported integration: ${input.provider}/${input.authKind}` };
  }

  try {
    const provider = createGa4Provider({
      propertyId: input.externalId,
      mintToken: minterFor(input.authKind, input.credentials),
    });
    await provider.health(AbortSignal.timeout(TIMEOUT_MS));
    return { ok: true, accountLabel: serviceAccountEmail(input.credentials) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
};
