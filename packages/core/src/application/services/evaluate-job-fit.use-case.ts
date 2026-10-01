import { createHash } from 'node:crypto';
import { JobFitEvaluation } from '../../domain/job/lifecycle/job-metadata.js';
import { CachePort } from '../ports/cache.port.js';
import { EmbeddingPort } from '../ports/embedding.port.js';
import { LoggerPort } from '../ports/logger.port.js';

const CACHE_PREFIX = 'embedding:profile';
/** Los modelos de embeddings tienen límite de tokens: se recorta el texto. */
const MAX_TEXT_CHARS = 8000;

export interface EvaluateJobFitOptions {
  /** score >= threshold → vale la pena postular. */
  threshold: number;
  /** Nombre del modelo de embeddings (se guarda con la evaluación y separa la caché). */
  model: string;
  /** TTL del embedding del perfil en caché (se recalcula si el perfil cambia). */
  profileCacheTtlSeconds?: number;
}

export interface EvaluateJobFitInput {
  /** Texto de la vacante: título, empresa, descripción… */
  jobText: string;
  profile: { id: string; text: string };
}

/**
 * Use case: ¿vale la pena guardar la vacante para postular?
 *
 * Compara por similitud coseno el embedding de la vacante con el del perfil
 * del candidato. El embedding del perfil se cachea por hash de su texto, así
 * que en una búsqueda solo se paga un embedding por vacante.
 */
export class EvaluateJobFitUseCase {
  constructor(
    private readonly embeddings: EmbeddingPort,
    private readonly cache: CachePort,
    private readonly logger: LoggerPort,
    private readonly options: EvaluateJobFitOptions,
  ) {}

  async execute(input: EvaluateJobFitInput): Promise<JobFitEvaluation> {
    const [profileVector, jobVector] = await Promise.all([
      this.profileEmbedding(input.profile.text),
      this.embeddings.getEmbedding(clip(input.jobText)),
    ]);

    const score = cosineSimilarity(profileVector, jobVector);
    const { threshold, model } = this.options;
    return {
      score: Number(score.toFixed(4)),
      threshold,
      worthApplying: score >= threshold,
      model,
      profileId: input.profile.id,
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async profileEmbedding(text: string): Promise<number[]> {
    const key = `${CACHE_PREFIX}:${this.options.model}:${createHash('sha256').update(text).digest('hex')}`;

    const [cached] = (await this.cache.mget([key])) ?? [null];
    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        this.logger.warn('Embedding del perfil corrupto en caché, se recalcula');
      }
    }

    const vector = await this.embeddings.getEmbedding(clip(text));
    await this.cache.set(key, JSON.stringify(vector), this.options.profileCacheTtlSeconds ?? 7 * 24 * 3600);
    this.logger.debug(`Embedding del perfil calculado (${vector.length} dimensiones)`);
    return vector;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(`Embeddings incompatibles: ${a.length} vs ${b.length} dimensiones`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function clip(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
