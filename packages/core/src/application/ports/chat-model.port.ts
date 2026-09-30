/**
 * Definición de una herramienta que el LLM puede invocar.
 *
 * `inputSchema` es un JSON Schema (el mismo formato que publica un MCP server
 * en `tools/list`), así que las tools descubiertas vía MCP se pasan tal cual.
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Invocación de una tool decidida por el LLM. `arguments` es JSON crudo. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

/**
 * Puerto de chat con soporte de tool-calling.
 *
 * Es lo que necesita un agente para que el LLM decida qué herramientas usar.
 * Los adapters de infraestructura (OpenRouter, OmniRoute, …) lo implementan.
 */
export interface ChatModelPort {
  chat(request: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): Promise<ChatResponse>;
}
