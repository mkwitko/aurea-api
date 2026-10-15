// Named export: sob NodeNext o default de ioredis é o namespace do módulo, não a classe.
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

const CHANNEL_PREFIX = 'agent-run:';

export type RunEvent = { runId: string; status: string };

type Listener = (event: RunEvent) => void;

// Uma conexão em modo subscriber não pode publicar (ioredis rejeita qualquer
// comando que não seja de subscribe nesse modo), então publish e subscribe
// vivem em conexões próprias — nunca a de BullMQ (`queue.ts`), que também é
// exclusiva do worker.
let publisher: Redis | undefined;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(env.REDIS_URL);
    // ioredis lança se 'error' não tem listener. Uma falha de publish já é
    // engolida por quem chama (ver comentário em runner.ts) — sem isto, uma
    // Redis fora do ar derrubaria o processo inteiro por causa de um evento
    // que só existe para acelerar a UI.
    publisher.on('error', () => {});
  }
  return publisher;
}

export async function publishRunEvent(workspaceId: string, event: RunEvent): Promise<void> {
  await getPublisher().publish(`${CHANNEL_PREFIX}${workspaceId}`, JSON.stringify(event));
}

// UMA conexão subscriber para o processo inteiro (psubscribe em
// `agent-run:*`), com o fan-out para cada workspace feito em memória — um
// socket a mais nunca abre uma conexão Redis a mais.
let subscriber: Redis | undefined;
const listenersByWorkspace = new Map<string, Set<Listener>>();

function getSubscriber(): Redis {
  if (subscriber) return subscriber;

  subscriber = new Redis(env.REDIS_URL);
  subscriber.on('error', () => {});
  // Fire-and-forget: subscribeRunEvents devolve o unsubscribe de forma
  // síncrona, então não há como esperar o ACK do psubscribe aqui. Uma
  // mensagem perdida na janela entre a conexão e o ACK é exatamente o caso que
  // o polling (30s) cobre — o socket é latência, não correção.
  subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch(() => {});
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const workspaceId = channel.slice(CHANNEL_PREFIX.length);
    const listeners = listenersByWorkspace.get(workspaceId);
    if (!listeners || listeners.size === 0) return;

    let event: RunEvent;
    try {
      event = JSON.parse(message) as RunEvent;
    } catch {
      return;
    }
    for (const listener of listeners) listener(event);
  });

  return subscriber;
}

/** Subscribes to run events for a single workspace. Returns the unsubscribe. */
export function subscribeRunEvents(workspaceId: string, listener: Listener): () => void {
  getSubscriber();

  let listeners = listenersByWorkspace.get(workspaceId);
  if (!listeners) {
    listeners = new Set();
    listenersByWorkspace.set(workspaceId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByWorkspace.delete(workspaceId);
  };
}

export async function closeRunEvents(): Promise<void> {
  await publisher?.quit();
  await subscriber?.quit();
  publisher = undefined;
  subscriber = undefined;
  listenersByWorkspace.clear();
}
