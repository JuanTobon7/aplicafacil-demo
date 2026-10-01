import { AiProvider } from '../../application/ports/ai-provider.js';
import { LoggerPort } from '../../application/ports/logger.port.js';
import { OpenRouterAdapter } from './open-router.adapter.js';
import { OmniRouteAdapter } from './omni-route.adapter.js';
import { FallbackAiProvider } from './fallback-ai.provider.js';

/**
 * Configuración de la fábrica de proveedores de IA.
 * Se construye en el bootstrap con los adapters ya instanciados.
 */
export interface AiProviderFactoryConfig {
  /** Uno o varios separados por coma, en orden de preferencia: "openrouter,omniroute". */
  provider: string;
  openRouter: OpenRouterAdapter;
  omniRoute: OmniRouteAdapter;
  /** Para loguear los failovers entre proveedores. */
  logger?: LoggerPort;
}

/**
 * Fábrica de proveedores de IA.
 *
 * Es la ÚNICA vía para obtener un AiProvider: el transporte (MCP o HTTP)
 * nunca instancia adapters directamente. Cambiar de proveedor = cambiar
 * la config (env LLM_PROVIDER), sin tocar tools ni rutas. Con varios
 * proveedores devuelve una cadena con failover (FallbackAiProvider).
 */
export class AiProviderFactory {
  constructor(private readonly config: AiProviderFactoryConfig) {}

  getProvider(): AiProvider {
    const names = this.config.provider
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    if (names.length === 0) throw new Error('LLM_PROVIDER vacío');
    if (names.length === 1) return this.byName(names[0]);

    return new FallbackAiProvider(
      names.map((name) => ({ name, provider: this.byName(name) })),
      this.config.logger,
    );
  }

  private byName(name: string): AiProvider {
    switch (name) {
      case 'openrouter':
        return this.config.openRouter;
      case 'omniroute':
        return this.config.omniRoute;
      default:
        throw new Error(`AiProvider "${name}" no soportado`);
    }
  }
}
