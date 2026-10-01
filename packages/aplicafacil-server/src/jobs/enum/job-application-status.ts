import { JobStatus } from '@aplicafacil/core/domain';

/**
 * Estados del ciclo de vida de una vacante en el módulo de jobs.
 *
 * Es el mismo conjunto de estados del patrón State del core (JobLifecycle),
 * que define qué transiciones son válidas:
 * DISCOVERED → (fit por embeddings) → MATCHED | SKIPPED
 * MATCHED → APPLYING → APPLIED / APPLICATION_FAILED
 *
 * SKIPPED: la IA determinó que no hay match suficiente.
 * REJECTED: la postulación fue rechazada (manual o por la empresa).
 */
export const JobApplicationStatus = JobStatus;
export type JobApplicationStatus = JobStatus;
