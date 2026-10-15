import type { AiCompletion, AiCompletionRequest, AiProvider } from './provider.js';

export function createFakeProvider(
  script: AiCompletion[],
): AiProvider & { requests: AiCompletionRequest[] } {
  const remaining = [...script];
  const requests: AiCompletionRequest[] = [];

  return {
    name: 'fake',
    requests,
    async complete(req: AiCompletionRequest): Promise<AiCompletion> {
      requests.push(req);
      const next = remaining.shift();
      if (!next) throw new Error('fake provider script exhausted');
      return next;
    },
  };
}
