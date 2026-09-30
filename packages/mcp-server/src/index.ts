import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/mcp.server.js';
import { createExpressApp } from './server/app.js';
import { BackendClient } from './backend/backend.client.js';
import { logger } from './logger/logger.js';

/**
 * Composition root del MCP Server.
 *
 * Transportes:
 *   - streamable-http en `/mcp` (por defecto): lo usa aplicafacil-server.
 *   - stdio con `--stdio`: para clientes locales (Claude Desktop, Inspector).
 */
async function main() {
  const backend = new BackendClient(
    process.env.BACKEND_URL ?? 'http://localhost:3000/api/v1',
  );
  const createServer = () => createMcpServer({ backend });

  if (process.argv.includes('--stdio')) {
    await createServer().connect(new StdioServerTransport());
    logger.success('✅ MCP server escuchando por stdio');
    return;
  }

  const port = parseInt(process.env.PORT || '3001', 10);
  createExpressApp(createServer).listen(port, () => {
    logger.success(`🚀 MCP server (streamable-http) en http://localhost:${port}/mcp`);
    logger.info(`   Backend: ${process.env.BACKEND_URL ?? 'http://localhost:3000/api/v1'}`);
  });
}

main().catch((error) => {
  logger.error('❌ Failed to start MCP server', error);
  process.exit(1);
});
