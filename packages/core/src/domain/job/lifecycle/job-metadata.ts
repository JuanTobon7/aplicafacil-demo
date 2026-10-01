/**
 * Estados del ciclo de vida de una vacante. Son los valores del enum
 * `jobs_status_enum` de la BD.
 *
 * DISCOVERED → (evaluación por embeddings) → MATCHED | SKIPPED
 * MATCHED → APPLYING → APPLIED | APPLICATION_FAILED
 */
export const JobStatus = {
  DISCOVERED: 'DISCOVERED',
  MATCHED: 'MATCHED',
  SKIPPED: 'SKIPPED',
  APPLYING: 'APPLYING',
  APPLIED: 'APPLIED',
  APPLICATION_FAILED: 'APPLICATION_FAILED',
  REJECTED: 'REJECTED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export type JobLanguage = 'es' | 'en' | 'unknown';

export interface JobLanguageInfo {
  code: JobLanguage;
  /** 0..1: qué tan clara es la diferencia entre idiomas en el texto. */
  confidence: number;
}

/** Resultado de comparar el embedding de la vacante con el del perfil. */
export interface JobFitEvaluation {
  /** Similitud coseno vacante ↔ perfil (≈ -1..1; en la práctica 0..1). */
  score: number;
  /** Umbral usado: score >= threshold → vale la pena postular. */
  threshold: number;
  worthApplying: boolean;
  /** Modelo de embeddings con el que se calculó (los scores no son comparables entre modelos). */
  model: string;
  profileId: string;
  evaluatedAt: string;
}

export interface JobTransition {
  from: JobStatus | null;
  to: JobStatus;
  at: string;
  reason?: string;
}

/**
 * Metadata que acompaña a la vacante a lo largo de su ciclo de vida
 * (se guarda en la columna jsonb `metadata` de `jobs`).
 */
export interface JobMetadata {
  language?: JobLanguageInfo;
  fit?: JobFitEvaluation;
  /** Último error al evaluar (p.ej. proveedor de embeddings caído): la vacante queda por re-evaluar. */
  evaluationError?: { message: string; at: string };
  /** Transiciones de estado, de la más antigua a la más reciente (acotado). */
  history: JobTransition[];
}
