import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { env } from '../../config/env.js';

// O único ponto onde env encontra tracing (mesmo desenho de
// integrations/search/index.ts). Exige as três variáveis juntas: uma chave
// sem baseUrl cairia no default de nuvem do SDK, e o motivo de self-hostear é
// justamente não deixar contexto de negócio do cliente sair para lá.
export function isTracingConfigured(): boolean {
  return env.LANGFUSE_SECRET_KEY !== undefined && env.LANGFUSE_PUBLIC_KEY !== undefined && env.LANGFUSE_BASEURL !== undefined;
}

let processor: LangfuseSpanProcessor | undefined;

// Registrado só na primeira trace de um processo configurado — um processo
// sem Langfuse nunca toca OpenTelemetry, então "não configurado" não é apenas
// "não exporta", é "não existe" para o resto do runtime.
export function ensureTracerRegistered(): void {
  if (processor) return;
  processor = new LangfuseSpanProcessor({
    secretKey: env.LANGFUSE_SECRET_KEY,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    baseUrl: env.LANGFUSE_BASEURL,
    // Um span por lote, e um segundo de espera no pior caso: cada chamada de
    // modelo e cada tool aparece no Langfuse assim que termina, com o run ainda
    // em andamento. É para isso que o tracing existe aqui — acompanhar um run
    // que travou não serve se o trace só chega quando o run acaba, e um run que
    // morre com o processo nunca acabaria.
    //
    // O padrão do SDK agrupa para poupar requisição. Aqui a informação em tempo
    // real vale mais que a economia: são poucos spans por run, e o exporter é
    // local.
    flushAt: 1,
    flushInterval: 1,
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
}

// Chamado onde o app já fecha as outras conexões (ver app.ts). Nunca deixa o
// desligamento travar por causa de uma falha ao exportar o que sobrou.
export async function flushTracing(): Promise<void> {
  if (!processor) return;
  try {
    await processor.forceFlush();
    await processor.shutdown();
  } catch {
    // Uma falha ao dar flush não pode atrasar (nem derrubar) o shutdown do processo.
  }
}
