import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FillFormRequestDto } from '@aplicafacil/core/domain';
import {
  CV_SYSTEM_EXTRACT,
  FILL_FORM_SYSTEM,
  buildFillFormPrompt,
} from '@aplicafacil/core/prompts';
import { BackendClient } from '../backend/backend.client.js';
import { buildTools, registerTools } from '../tools/index.js';

export interface McpServerDeps {
  backend: BackendClient;
}

/**
 * Construye una instancia del MCP server con sus tools, resources y prompts.
 *
 * El server NO llama a ningún LLM: solo publica capacidades. El cliente MCP
 * (host) las descubre con `tools/list` y su LLM decide cuáles invocar.
 */
export function createMcpServer({ backend }: McpServerDeps): McpServer {
  const server = new McpServer({
    name: 'aplicafacil-mcp-server',
    version: '1.0.0',
  });

  // ── Tools ───────────────────────────────────────────────────────────
  registerTools(server, buildTools(backend));

  // ── Resources (mismos datos que las tools, para clientes que prefieren leer) ──
  server.registerResource(
    'candidate-profile',
    new ResourceTemplate('candidate://profile/{id}', { list: undefined }),
    {
      title: 'Candidate Profile',
      description: 'Perfil profesional de un candidato (skills, experiencias, educación)',
      mimeType: 'application/json',
    },
    async (uri, { id }) => jsonResource(uri.href, await backend.getProfile(String(id))),
  );

  server.registerResource(
    'candidate-person',
    new ResourceTemplate('candidate://person/{id}', { list: undefined }),
    {
      title: 'Candidate Person',
      description: 'Datos personales de un candidato (nombre, email, teléfono, LinkedIn)',
      mimeType: 'application/json',
    },
    async (uri, { id }) => jsonResource(uri.href, await backend.getPerson(String(id))),
  );

  // ── Prompts (los argumentos MCP de un prompt son siempre strings) ────
  server.registerPrompt(
    'fill-form-prompt',
    {
      title: 'Fill Form Prompt',
      description: 'Prompt para completar un formulario de postulación',
      argsSchema: {
        request: z.string().describe('FillFormRequestDto serializado como JSON'),
      },
    },
    ({ request }) => {
      const body = JSON.parse(request) as FillFormRequestDto;
      return userMessage(`${FILL_FORM_SYSTEM}\n\n${buildFillFormPrompt(body)}`);
    },
  );

  server.registerPrompt(
    'cv-extract-prompt',
    {
      title: 'CV Extract Prompt',
      description: 'Prompt para extraer un perfil estructurado del texto de un CV',
      argsSchema: {
        data: z.string().min(1).describe('Texto crudo del CV'),
      },
    },
    ({ data }) => userMessage(`${CV_SYSTEM_EXTRACT}\n\n${data}`),
  );

  return server;
}

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
  };
}

// MCP prompts solo aceptan role "user" | "assistant": system + user van juntos.
function userMessage(text: string) {
  return {
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  };
}
