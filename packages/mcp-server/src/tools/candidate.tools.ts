import { z } from 'zod';
import { BackendClient } from '../backend/backend.client.js';
import { defineTool, McpToolDefinition } from './tool.js';

/**
 * Tools de datos del candidato. Solo exponen capacidades: es el LLM del
 * cliente MCP quien decide si y cuándo usarlas.
 */
export function candidateTools(backend: BackendClient): McpToolDefinition[] {
  return [
    defineTool({
      name: 'get_candidate_profile',
      description:
        'Obtiene el perfil profesional de un candidato por profileId: título, resumen, ' +
        'skills, experiencias laborales y educación. Úsala cuando necesites datos ' +
        'profesionales reales del candidato (experiencia, años, tecnologías, estudios).',
      inputSchema: {
        profileId: z.string().min(1).describe('ID del perfil del candidato'),
      },
      handler: ({ profileId }) => backend.getProfile(profileId),
    }),

    defineTool({
      name: 'get_candidate_person',
      description:
        'Obtiene los datos personales de un candidato por personId: nombre, apellido, ' +
        'email, teléfono y LinkedIn. Úsala cuando el formulario pida datos de contacto.',
      inputSchema: {
        personId: z.string().min(1).describe('ID de la persona (candidato)'),
      },
      handler: ({ personId }) => backend.getPerson(personId),
    }),
  ];
}
