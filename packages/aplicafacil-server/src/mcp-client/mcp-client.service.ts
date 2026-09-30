import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  ToolCallResult,
  ToolDefinition,
  ToolGatewayPort,
} from '@aplicafacil/core/application';

const TOOLS_CACHE_TTL_MS = 60_000;

/**
 * Cliente MCP real sobre streamable-http.
 *
 * No conoce endpoints ni tools concretas: descubre el catálogo con
 * `tools/list` y ejecuta lo que el LLM decida con `tools/call`.
 * Implementa ToolGatewayPort para que el agente del core lo use.
 */
@Injectable()
export class McpClientService implements ToolGatewayPort, OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private readonly serverUrl: URL;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private toolsCache: { tools: ToolDefinition[]; expiresAt: number } | null =
    null;

  constructor(configService: ConfigService) {
    const base =
      configService.get<string>('MCP_SERVER_URL') || 'http://localhost:3001';
    this.serverUrl = new URL('/mcp', base);
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (this.toolsCache && this.toolsCache.expiresAt > Date.now()) {
      return this.toolsCache.tools;
    }

    const client = await this.getClient();
    const tools: ToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of page.tools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);

    this.toolsCache = { tools, expiresAt: Date.now() + TOOLS_CACHE_TTL_MS };
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const client = await this.getClient();
    const result = await client.callTool({ name, arguments: args });

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((part: any) =>
        part.type === 'text' ? part.text : JSON.stringify(part),
      )
      .join('\n');

    return { content: text, isError: result.isError === true };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const client = new Client({ name: 'aplicafacil-server', version: '1.0.0' });
    client.onclose = () => {
      this.client = null;
      this.toolsCache = null;
    };

    this.logger.log(`Conectando al MCP server en ${this.serverUrl.href}`);
    await client.connect(new StreamableHTTPClientTransport(this.serverUrl));
    this.client = client;
    return client;
  }
}
