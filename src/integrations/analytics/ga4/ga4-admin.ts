import { z } from 'zod';
import { AnalyticsProviderError } from '../analytics-provider.js';

const BASE = 'https://analyticsadmin.googleapis.com/v1beta';

/** O teto da API. Uma página; mais que isso é declarado, não escondido. */
const PAGE_SIZE = 200;

/** O que a tela mostra: nome que o humano reconhece, e a conta que o situa. */
export type SourceProperty = { propertyId: string; displayName: string; accountName: string };

const summariesSchema = z.object({
  // Sem `.default([])`: uma resposta que não traz nem essa chave não é uma
  // conta sem properties, é um corpo que não é o contrato — e o caller
  // (`listGa4Properties`) trata isso como "unreadable", não como lista vazia.
  accountSummaries: z.array(
    z.object({
      displayName: z.string().optional(),
      propertySummaries: z
        .array(z.object({ property: z.string(), displayName: z.string().optional() }))
        .optional(),
    }),
  ),
  nextPageToken: z.string().optional(),
});

/**
 * As properties que aquela credencial enxerga.
 *
 * É o motivo de o OAuth existir: com service account o fundador tem de caçar o
 * id numérico no console; aqui ele reconhece "Site institucional".
 */
export async function listGa4Properties(
  mintToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<{ properties: SourceProperty[]; truncated: boolean }> {
  const token = await mintToken();
  const response = await fetch(`${BASE}/accountSummaries?pageSize=${PAGE_SIZE}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((json: unknown) => {
        const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(json);
        return parsed.success ? parsed.data.error.message : null;
      })
      .catch(() => null);
    throw new AnalyticsProviderError(detail ?? `ga4 admin request failed with status ${response.status}`);
  }

  const parsed = summariesSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable account summaries');

  const properties = parsed.data.accountSummaries.flatMap((account) =>
    (account.propertySummaries ?? []).map((property) => ({
      // `properties/123` → `123`: o resto do sistema guarda o id, e monta o
      // caminho onde precisa dele.
      propertyId: property.property.replace(/^properties\//, ''),
      displayName: property.displayName ?? property.property,
      accountName: account.displayName ?? '',
    })),
  );

  return { properties, truncated: parsed.data.nextPageToken !== undefined };
}
