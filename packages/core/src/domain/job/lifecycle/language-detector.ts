import { JobLanguageInfo } from './job-metadata.js';

// Palabras funcionales muy frecuentes y exclusivas de cada idioma
// ("a", "no", "me"… existen en ambos y se excluyen).
const ES = new Set([
  'el', 'la', 'los', 'las', 'del', 'de', 'que', 'y', 'en', 'un', 'una', 'para', 'con', 'por',
  'es', 'su', 'sus', 'al', 'como', 'más', 'o', 'se', 'lo', 'experiencia', 'conocimientos',
  'requisitos', 'trabajo', 'empresa', 'años', 'buscamos', 'nuestro', 'nuestra', 'equipo',
  'desarrollo', 'será', 'tendrás', 'estamos', 'ofrecemos', 'cargo', 'deseable', 'manejo',
]);
const EN = new Set([
  'the', 'and', 'of', 'to', 'in', 'for', 'with', 'is', 'are', 'you', 'your', 'our', 'we',
  'will', 'be', 'on', 'as', 'or', 'an', 'this', 'that', 'experience', 'skills', 'team',
  'work', 'years', 'looking', 'requirements', 'job', 'company', 'development', 'ability',
  'strong', 'knowledge', 'preferred', 'responsibilities', 'what', 'about', 'who',
]);

/** Mínimo de palabras reconocidas para dar un veredicto. */
const MIN_HITS = 5;

/**
 * Detecta si un texto está en español o inglés contando palabras funcionales.
 * Es determinista y sin costo (no llama a ningún modelo): suficiente para
 * textos largos como la descripción de una vacante.
 */
export function detectLanguage(text: string | undefined | null): JobLanguageInfo {
  const words = (text ?? '').toLowerCase().match(/[a-záéíóúüñ]+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const word of words) {
    if (ES.has(word)) es++;
    else if (EN.has(word)) en++;
  }
  // Letras propias del español: desempatan textos cortos o mixtos
  es += Math.min(5, ((text ?? '').match(/[ñ¿¡]/g) ?? []).length);

  const total = es + en;
  if (total < MIN_HITS) return { code: 'unknown', confidence: 0 };
  const confidence = Number((Math.abs(es - en) / total).toFixed(2));
  if (confidence < 0.2) return { code: 'unknown', confidence };
  return { code: es > en ? 'es' : 'en', confidence };
}
