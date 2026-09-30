import { FillFormRequestDto } from '../domain/job/fill.form.request.dto.js';

export const FILL_FORM_SYSTEM = `
Eres un asistente experto en completar formularios de aplicación laboral.
Tu tarea es generar el valor más apropiado para cada campo del formulario,
basándote en la descripción de la vacante, el contexto de la empresa y los
datos reales del candidato.

HERRAMIENTAS:
- Tienes herramientas para consultar los datos del candidato (perfil, datos
  personales). Si el formulario pide información del candidato y se te dieron
  sus identificadores, úsalas antes de responder. Nunca inventes datos del candidato.

REGLAS — síguelas sin excepción:
- Responde ÚNICAMENTE con un JSON array. Sin texto adicional, sin markdown, sin backticks.
- Cada elemento del array debe tener exactamente esta forma:
{
    "fieldName":      "string",   <- el campo 'name' del input, igual al recibido
    "value":          "string | null",
    "confidence":     number,     <- entre 0.0 y 1.0
    "requires_review": boolean
}
- Para campos tipo SELECT: elige el value (no el label) de la opción más apropiada.
Si hay una opción por defecto como "Selecciona una opción", nunca la elijas.
- Para EMAIL en select: elige el email disponible en las opciones, nunca inventes uno.
- Para CÓDIGO DE PAÍS: elige "Colombia (+57)" si el candidato es colombiano.
- Para TELÉFONO: usa el del candidato si lo obtuviste con las herramientas; si no, devuelve null y requires_review: true. Nunca inventes un número.
- Si no puedes inferir un valor razonable, devuelve value: null y confidence: 0.
`.trim();

export const buildFillFormPrompt = (body: FillFormRequestDto): string => {
  const { metadata, fields } = body;

  // Filtramos las opciones de selects muy largos (ej: lista de 200 países)
  // para no desperdiciar tokens — solo mandamos las primeras 5 + la relevante
  const sanitizedFields = fields.map(f => {
    if (f.type === 'select' && f.options && f.options.length > 10) {
      // Detecta si es lista de países por el label del campo
      const isPaisField =
        f.label.toLowerCase().includes('país') ||
        f.label.toLowerCase().includes('country') ||
        f.label.toLowerCase().includes('código');

      if (isPaisField) {
        // Solo manda Colombia y las primeras 3 para dar contexto del formato
        const colombia = f.options.find(o =>
          o.label.toLowerCase().includes('colombia'),
        );
        const sample = f.options.slice(0, 3);
        return {
          ...f,
          options: [
            ...sample,
            ...(colombia ? [colombia] : []),
            { value: '...', label: '(y otros países)' },
          ],
        };
      }
    }
    return f;
  });

  const candidate = [
    body.profileId ? `profileId: ${body.profileId}` : '',
    body.personId ? `personId:  ${body.personId}` : '',
  ].filter(Boolean);

  return `
    ## Candidato
    ${candidate.length ? candidate.join('\n    ') : 'Sin identificadores: no hay datos del candidato disponibles.'}

    ## Vacante
    Título:   ${metadata.title}
    Empresa:  ${metadata.company}
    Lugar:    ${metadata.location}
    Modalidad: ${metadata.workplaceType ?? 'no especificada'}
    URL:      ${body.url}

    ## Descripción completa
    """
    ${metadata.description.slice(0, 1500)}
    ${metadata.description.length > 1500 ? '\n... [descripción truncada]' : ''}
    """

    ## Campos del formulario a completar (${sanitizedFields.length} campos)
    ${sanitizedFields
      .map((f, i) => {
        return `
    Campo ${i + 1}:
    name:      "${f.name}"
    label:     "${f.label}"
    tipo:      ${f.type}
    requerido: ${f.required}
    ${f.placeholder ? `placeholder: "${f.placeholder}"` : ''}
    ${
      f.options?.length
        ? `opciones disponibles:\n${f.options
            .map(o => `    - value: "${o.value}" | label: "${o.label}"`)
            .join('\n')}`
        : ''
    }
    `;
      })
      .join('')}

    Devuelve el JSON array con exactamente ${sanitizedFields.length} objetos, uno por campo.
    `.trim();
};