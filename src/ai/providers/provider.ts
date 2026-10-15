export type AiUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
export type AiToolCall = { id: string; name: string; args: unknown };
export type AiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };
export type AiToolSpec = { name: string; description: string; parameters: unknown };
export type AiCompletionRequest = {
  modelId: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  jsonMode: boolean;
  maxTokens: number;
  signal: AbortSignal;
};
export type AiCompletion = {
  text: string | null;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'other';
};
export interface AiProvider {
  readonly name: string;
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}

export class ProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
