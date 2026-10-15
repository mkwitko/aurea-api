import { createTraceId } from '@langfuse/tracing';
import { env } from '../../config/env.js';
import { isTracingConfigured } from './langfuse-client.js';

/**
 * O endereço da trace de um run, calculado — não guardado.
 *
 * `startRunTrace` deriva o traceId do agentRunId com o mesmo `createTraceId`,
 * então a URL sai de uma linha do banco sem coluna nova e sem migração. O
 * caminho `/trace/:id` é o atalho do Langfuse que resolve o projeto sozinho:
 * a alternativa exigiria conhecer o projectId aqui, que é configuração que
 * não temos motivo para carregar.
 */
export async function traceUrlFor(agentRunId: string): Promise<string | null> {
  if (!isTracingConfigured() || !env.LANGFUSE_BASEURL) return null;
  try {
    const traceId = await createTraceId(agentRunId);
    return `${env.LANGFUSE_BASEURL.replace(/\/$/, '')}/trace/${traceId}`;
  } catch {
    // Um link ausente é uma inconveniência; uma exceção aqui derrubaria a
    // resposta de um endpoint que só queria mostrar um run.
    return null;
  }
}
