import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../logger/logger.js';

/**
 * Definición uniforme de una tool MCP.
 *
 * El handler devuelve datos planos; `registerTools` se encarga de serializarlos
 * y de convertir cualquier excepción en un resultado `isError` que el LLM ve.
 */
export interface McpToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  tool: McpToolDefinition<Shape>,
): McpToolDefinition {
  return tool as unknown as McpToolDefinition;
}

export function registerTools(server: McpServer, tools: McpToolDefinition[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: any) => {
        logger.debug(`MCP tool "${tool.name}" invocada`, args);
        try {
          const result = await tool.handler(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`MCP tool "${tool.name}" falló`, message);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
          };
        }
      },
    );
  }
}
