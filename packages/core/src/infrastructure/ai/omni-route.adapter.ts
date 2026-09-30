import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';

/**
 * Configuración del adapter de OmniRoute.
 * Se inyecta desde el bootstrap (env vars), no se lee aquí.
 */
export interface OmniRouteAdapterConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  embeddingModel?: string;
  /** Fetch wrapper opcional para observabilidad (logging de tráfico). */
  fetch?: typeof fetch;
}

/**
 * Adapter de infraestructura: OmniRoute vía SDK de OpenAI.
 *
 * Implementa AiProvider (completación, chat con tools y embeddings). No conoce
 * MCP ni HTTP: es intercambiable por cualquier otro proveedor.
 */
export class OmniRouteAdapter extends OpenAiCompatibleAdapter {
  constructor(config: OmniRouteAdapterConfig) {
    super({
      apiKey: config.apiKey ?? 'not-needed-if-no-auth-configured',
      baseURL: config.baseURL ?? 'http://localhost:20128/v1',
      model: config.model ?? 'auto',
      embeddingModel: config.embeddingModel ?? 'text-embedding-3-small',
      fetch: config.fetch,
    });
  }
}
