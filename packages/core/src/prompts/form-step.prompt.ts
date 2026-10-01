import { FormStepState } from '../domain/job/form-step.js';
import { JobLanguage } from '../domain/job/lifecycle/job-metadata.js';

export const FORM_STEP_SYSTEM = `
Eres un agente que completa formularios de postulación laboral PASO A PASO.
En cada turno recibes la foto del paso actual (campos vacíos y clickeables,
cada uno con su id) y respondes con las acciones que el navegador debe
ejecutar, en orden. Después verás el siguiente paso, hasta que la solicitud
quede enviada.

HERRAMIENTAS:
- Tienes herramientas para consultar los datos del candidato (perfil, datos
  personales). Úsalas antes de llenar campos con datos del candidato.
  Nunca inventes datos del candidato.

ACCIONES (usa SOLO ids que aparezcan en el paso actual):
- {"type":"fill","id":"<id del campo>","value":"<valor>","confidence":0.0-1.0,"requires_review":bool}
  · SELECT: value es el value de la opción (no el label). Nunca elijas "Selecciona una opción".
  · RADIO: value es el value o el label de la opción.
  · CHECKBOX: "true" para marcarlo, "false" para dejarlo.
  · TELÉFONO: el del candidato; si no lo tienes, no llenes el campo.
  · CÓDIGO DE PAÍS: "Colombia (+57)" si el candidato es colombiano.
- {"type":"upload","id":"<id del clickeable>"} sube el CV del candidato con ese
  botón/input (kind "upload"). Solo si hay CV disponible y el paso lo pide, y
  no lo subiste ya en un paso anterior.
- {"type":"click","id":"<id del clickeable>"} pulsa un botón. Úsalo para avanzar
  (siguiente / revisar / enviar) y va SIEMPRE al final: tras un click la página
  cambia y las acciones restantes se descartan.

REGLAS:
- Llena todos los campos requeridos que puedas y luego avanza con UN click.
- FORMATO: respeta "solo números" y "máximo N caracteres". Preguntas de
  cantidad ("¿cuántos años…?", salario, etc.) se responden SOLO con el número
  (p.ej. "3"), nunca con una frase.
- PREGUNTAS de experiencia, años o habilidades (sí/no, numéricas): responde
  según el perfil del candidato. Si el perfil no lo respalda, responde "No"
  (o 0 años): nunca exageres la experiencia para pasar el filtro.
- IDIOMA: escribe los textos libres en el idioma de la vacante. Si el paso
  ofrece elegir entre varios CV, elige el que esté en ese idioma.
- Si hay errores de validación, corrige los campos implicados antes de volver a avanzar.
- Revisa el historial: si un click no avanzó, no repitas lo mismo sin corregir algo.
- Nunca pulses botones de descartar, cerrar, cancelar, atrás o guardar.
- Si no puedes continuar (falta un dato imprescindible, captcha, login…),
  responde status "blocked" con el motivo.

Responde ÚNICAMENTE con un objeto JSON, sin markdown ni texto adicional:
{"status":"continue"|"blocked","actions":[...],"reason":"string opcional"}
`.trim();

export const buildFormStepPrompt = (state: FormStepState): string => {
  const { metadata } = state;

  const candidate = [
    state.profileId ? `profileId: ${state.profileId}` : '',
    state.personId ? `personId: ${state.personId}` : '',
    `CV disponible: ${state.resumeName ?? 'no'}`,
  ].filter(Boolean);

  const fields = state.fields.map((f) => {
    const lines = [
      `- id: "${f.name}" | label: "${f.label}" | tipo: ${f.type}${f.required ? ' | requerido' : ''}`,
    ];
    if (f.placeholder) lines.push(`  placeholder: "${f.placeholder}"`);
    if (f.numeric) lines.push('  solo números');
    if (f.maxLength) lines.push(`  máximo ${f.maxLength} caracteres`);
    if (f.currentValue !== undefined) {
      lines.push(`  valor actual CON ERROR (reemplázalo): "${f.currentValue}"${f.error ? ` — ${f.error}` : ''}`);
    }
    const options = f.options ?? [];
    for (const o of limitOptions(options)) {
      lines.push(`  · value: "${o.value}" | label: "${o.label}"`);
    }
    if (options.length > MAX_OPTIONS) lines.push(`  · … (${options.length} opciones en total)`);
    return lines.join('\n');
  });

  return `
## Candidato
${candidate.join('\n')}

## Vacante
Idioma: ${LANGUAGE_NAMES[state.language ?? 'unknown']}
Título: ${metadata.title}
Empresa: ${metadata.company}
Lugar: ${metadata.location}
Modalidad: ${metadata.workplaceType ?? 'no especificada'}
URL: ${state.url}

## Descripción
"""
${metadata.description.slice(0, 1500)}${metadata.description.length > 1500 ? '\n... [truncada]' : ''}
"""

## Historial de este formulario
${state.history.length ? state.history.join('\n') : '(primer paso)'}

## Paso ${state.step}${state.heading ? ` — ${state.heading}` : ''}
Errores visibles: ${state.errors.length ? state.errors.join(' | ') : 'ninguno'}

Campos ya llenos (no tocar salvo que tengan error):
${state.filled.length ? state.filled.map((f) => `- "${f.label}" = "${f.value}"`).join('\n') : '(ninguno)'}

Campos vacíos:
${fields.length ? fields.join('\n') : '(ninguno)'}

Clickeables:
${state.clickables.length ? state.clickables.map((c) => `- id: "${c.id}" | kind: ${c.kind} | "${c.text}"`).join('\n') : '(ninguno)'}
`.trim();
};

const MAX_OPTIONS = 30;

const LANGUAGE_NAMES: Record<JobLanguage, string> = {
  es: 'español',
  en: 'inglés',
  unknown: 'no determinado (usa el idioma de las preguntas del formulario)',
};

/** Listas largas (p.ej. 200 países): las primeras + Colombia. */
function limitOptions<T extends { label: string }>(options: T[]): T[] {
  if (options.length <= MAX_OPTIONS) return options;
  const colombia = options.filter((o) => /colombia/i.test(o.label));
  return [...options.slice(0, MAX_OPTIONS - colombia.length), ...colombia];
}
