import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';

/**
 * Configuración del adapter de OpenRouter.
 * Se inyecta desde el bootstrap (env vars), no se lee aquí.
 */
export interface OpenRouterAdapterConfig {
  apiKey: string;
  baseURL: string;
  model?: string;
  embeddingModel?: string;
  /** Fetch wrapper opcional para observabilidad (logging de tráfico). */
  fetch?: typeof fetch;
}

/**
 * Adapter de infraestructura: OpenRouter vía SDK de OpenAI.
 *
 * Implementa AiProvider (completación, chat con tools y embeddings). No conoce
 * MCP ni HTTP: es intercambiable por cualquier otro proveedor.
 */
export class OpenRouterAdapter extends OpenAiCompatibleAdapter {
  constructor(config: OpenRouterAdapterConfig) {
    super({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model ?? 'google/gemini-2.5-flash',
      embeddingModel: config.embeddingModel ?? 'text-embedding-3-small',
      fetch: config.fetch,
    });
  }
}
