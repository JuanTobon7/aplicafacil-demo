import { BackendClient } from '../backend/backend.client.js';
import { candidateTools } from './candidate.tools.js';
import { McpToolDefinition } from './tool.js';

export { registerTools } from './tool.js';
export type { McpToolDefinition } from './tool.js';

/** Catálogo completo de tools que publica el MCP server. */
export function buildTools(backend: BackendClient): McpToolDefinition[] {
  return [...candidateTools(backend)];
}
