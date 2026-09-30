import { ToolDefinition } from './chat-model.port.js';

export interface ToolCallResult {
  /** Contenido textual devuelto por la tool (normalmente JSON). */
  content: string;
  /** true si la tool reportó un error (se le pasa igual al LLM para que se recupere). */
  isError: boolean;
}

/**
 * Puerto hacia un catálogo de herramientas externo.
 *
 * La implementación natural es un cliente MCP: `listTools` ↔ `tools/list`,
 * `callTool` ↔ `tools/call`. El agente no sabe qué tools existen ni cómo se
 * ejecutan: las descubre en tiempo de ejecución.
 */
export interface ToolGatewayPort {
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}
