import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../logger/logger.js';

/**
 * Express app que expone el MCP server por streamable-http en `/mcp`.
 *
 * Modo sin estado: cada request crea su propio server + transport. Así
 * cualquier cliente (o el mismo cliente tras reiniciarse) puede conectarse
 * sin depender de una sesión previa en memoria.
 */
export function createExpressApp(createServer: () => McpServer): Express {
  const app = express();

  app.use(cors({ exposedHeaders: ['Mcp-Session-Id'] }));
  app.use(express.json({ limit: '10mb' }));

  // Una línea por mensaje MCP recibido (initialize, tools/list, tools/call…)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const messages = Array.isArray(req.body) ? req.body : req.body ? [req.body] : [];
    for (const msg of messages) {
      if (typeof msg?.method !== 'string' || msg.method.startsWith('notifications/')) continue;
      const tool = msg.method === 'tools/call' ? ` "${msg.params?.name}"` : '';
      logger.info(`📨 MCP ← ${msg.method}${tool}`);
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Error handling MCP request', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Sin sesiones no hay stream SSE (GET) ni cierre de sesión (DELETE).
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}
