import { AiProvider } from '../../application/ports/ai-provider.js';
import { ChatMessage, ChatResponse, ToolDefinition } from '../../application/ports/chat-model.port.js';
import { LoggerPort } from '../../application/ports/logger.port.js';

export interface NamedProvider {
  name: string;
  provider: AiProvider;
}

/**
 * Cadena de proveedores de IA con failover (p.ej. OpenRouter → OmniRoute).
 *
 * Cada llamada prueba los proveedores en orden. Si uno falla, se usa el
 * siguiente y el caído queda en "cooldown" un tiempo que depende del error,
 * para no pagar la latencia del fallo en cada llamada:
 * - 401/403 (sin clave o clave inválida) y 402 (sin créditos): 30 min.
 * - 429 (rate limit, típico de los modelos :free): 1 min.
 * - 5xx, timeouts y errores de red: 30 s.
 * Si todos están en cooldown se prueban igual (mejor intentar que fallar seguro).
 */
export class FallbackAiProvider implements AiProvider {
  private readonly downUntil = new Map<string, number>();

  constructor(
    private readonly providers: NamedProvider[],
    private readonly logger?: LoggerPort,
  ) {
    if (providers.length === 0) throw new Error('FallbackAiProvider sin proveedores');
  }

  complete(request: { system: string; prompt: string; data?: string }): Promise<string> {
    return this.run((p) => p.complete(request));
  }

  chat(request: { messages: ChatMessage[]; tools?: ToolDefinition[] }): Promise<ChatResponse> {
    return this.run((p) => p.chat(request));
  }

  getEmbedding(data: any): Promise<number[]> {
    return this.run((p) => p.getEmbedding(data));
  }

  private async run<T>(call: (provider: AiProvider) => Promise<T>): Promise<T> {
    const now = Date.now();
    const available = this.providers.filter((p) => (this.downUntil.get(p.name) ?? 0) <= now);
    const order = available.length > 0 ? available : this.providers;

    const failures: string[] = [];
    for (const { name, provider } of order) {
      try {
        const result = await call(provider);
        this.downUntil.delete(name);
        return result;
      } catch (error) {
        const status = statusOf(error);
        const cooldown = cooldownFor(status);
        this.downUntil.set(name, Date.now() + cooldown);
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${name}: ${message}`);
        this.logger?.warn(
          `Proveedor IA "${name}" falló (${message}); en cooldown ${Math.round(cooldown / 1000)}s, probando el siguiente`,
        );
      }
    }
    throw new Error(`Todos los proveedores de IA fallaron → ${failures.join(' | ')}`);
  }
}

/** Status HTTP del error del SDK de OpenAI (APIError.status), si lo tiene. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function cooldownFor(status: number | undefined): number {
  if (status === 401 || status === 402 || status === 403) return 30 * 60_000;
  if (status === 429) return 60_000;
  return 30_000;
}
