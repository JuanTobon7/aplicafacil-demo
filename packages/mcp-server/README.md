# AplicaFacil MCP Server

MCP server que publica **capacidades** (tools, resources, prompts) sobre los datos del
candidato. No llama a ningún LLM: el host (`aplicafacil-server`) descubre las tools con
`tools/list` y es su LLM quien decide cuáles invocar con `tools/call`.

```
aplicafacil-server (host MCP)
  FillFormUseCase / ExtractCvUseCase
        │  AI_COMPLETION_PORT
        ▼
  ToolCallingAgent (core) ──chat + tools──▶ LLM (OpenRouter / OmniRoute)
        │  el LLM pide una tool
        ▼
  McpClientService ──MCP streamable-http (/mcp)──▶ mcp-server ──HTTP──▶ backend /api/v1
```

## Capacidades

| Tipo     | Nombre                      | Qué hace                                          |
|----------|-----------------------------|---------------------------------------------------|
| tool     | `get_candidate_profile`     | Perfil profesional (skills, experiencia, estudios) |
| tool     | `get_candidate_person`      | Datos personales (nombre, email, teléfono, LinkedIn) |
| resource | `candidate://profile/{id}`  | Igual que la tool, para clientes que leen recursos |
| resource | `candidate://person/{id}`   | Idem                                              |
| prompt   | `fill-form-prompt`          | Prompt para completar formularios (`request` = JSON) |
| prompt   | `cv-extract-prompt`         | Prompt para extraer un perfil de un CV            |

## Añadir una tool

1. Defínela con `defineTool` (ver `src/tools/candidate.tools.ts`): nombre, descripción
   (el LLM la lee para decidir cuándo usarla), `inputSchema` zod y `handler`.
2. Si consulta el backend, añade el método en `src/backend/backend.client.ts`.
3. Inclúyela en `buildTools` (`src/tools/index.ts`). `registerTools` serializa el
   resultado y convierte las excepciones en resultados `isError`.

## Ejecución

- `npm run dev` / `npm start`: streamable-http en `http://localhost:$PORT/mcp` (sin estado).
- `node dist/index.js --stdio`: transporte stdio (Claude Desktop, `npm run inspect`).

Variables: `PORT` (3001), `BACKEND_URL` (`http://localhost:3000/api/v1`).
