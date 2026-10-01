import { JobFitEvaluation, JobStatus } from './job-metadata.js';

export type JobEvent = 'evaluate' | 'startApplying' | 'applied' | 'failed' | 'recover' | 'reject';

export class InvalidJobTransitionError extends Error {
  constructor(
    readonly status: JobStatus,
    readonly event: JobEvent,
  ) {
    super(`Transición inválida: "${event}" no está permitido en estado ${status}`);
    this.name = 'InvalidJobTransitionError';
  }
}

/**
 * Patrón State: cada estado de la vacante decide qué eventos acepta y a qué
 * estado lleva cada uno. Por defecto todo evento es inválido; cada estado
 * sobreescribe solo los que permite.
 */
export abstract class JobState {
  abstract readonly status: JobStatus;

  /** La IA evaluó por embeddings si la vacante vale la pena. */
  evaluate(_fit: JobFitEvaluation): JobState {
    return this.invalid('evaluate');
  }

  /** El worker reclamó la vacante para postular. */
  startApplying(): JobState {
    return this.invalid('startApplying');
  }

  applied(): JobState {
    return this.invalid('applied');
  }

  failed(): JobState {
    return this.invalid('failed');
  }

  /** Una postulación quedó a medias (p.ej. reinicio del server): vuelve a la cola. */
  recover(): JobState {
    return this.invalid('recover');
  }

  /** Rechazada (manual o por la empresa). */
  reject(): JobState {
    return this.invalid('reject');
  }

  protected invalid(event: JobEvent): never {
    throw new InvalidJobTransitionError(this.status, event);
  }
}

/** Resultado de una evaluación → MATCHED o SKIPPED. */
const byFit = (fit: JobFitEvaluation): JobState =>
  fit.worthApplying ? new MatchedState() : new SkippedState();

/** Recién encontrada en la búsqueda, pendiente de evaluar. */
export class DiscoveredState extends JobState {
  readonly status = JobStatus.DISCOVERED;
  evaluate(fit: JobFitEvaluation): JobState {
    return byFit(fit);
  }
  reject(): JobState {
    return new RejectedState();
  }
}

/** Vale la pena postular: espera en la cola. */
export class MatchedState extends JobState {
  readonly status = JobStatus.MATCHED;
  /** Re-evaluar (p.ej. vacantes antiguas o perfil actualizado) puede descartarla. */
  evaluate(fit: JobFitEvaluation): JobState {
    return byFit(fit);
  }
  startApplying(): JobState {
    return new ApplyingState();
  }
  reject(): JobState {
    return new RejectedState();
  }
}

/** La IA decidió que no vale la pena. Se guarda para no re-evaluarla en cada búsqueda. */
export class SkippedState extends JobState {
  readonly status = JobStatus.SKIPPED;
  /** Si cambia el perfil o el umbral, puede volver a la cola. */
  evaluate(fit: JobFitEvaluation): JobState {
    return byFit(fit);
  }
}

export class ApplyingState extends JobState {
  readonly status = JobStatus.APPLYING;
  applied(): JobState {
    return new AppliedState();
  }
  failed(): JobState {
    return new ApplicationFailedState();
  }
  recover(): JobState {
    return new MatchedState();
  }
}

export class AppliedState extends JobState {
  readonly status = JobStatus.APPLIED;
  reject(): JobState {
    return new RejectedState();
  }
}

export class ApplicationFailedState extends JobState {
  readonly status = JobStatus.APPLICATION_FAILED;
  reject(): JobState {
    return new RejectedState();
  }
}

export class RejectedState extends JobState {
  readonly status = JobStatus.REJECTED;
}

export function stateFor(status: JobStatus): JobState {
  switch (status) {
    case JobStatus.DISCOVERED:
      return new DiscoveredState();
    case JobStatus.MATCHED:
      return new MatchedState();
    case JobStatus.SKIPPED:
      return new SkippedState();
    case JobStatus.APPLYING:
      return new ApplyingState();
    case JobStatus.APPLIED:
      return new AppliedState();
    case JobStatus.APPLICATION_FAILED:
      return new ApplicationFailedState();
    case JobStatus.REJECTED:
      return new RejectedState();
    default:
      throw new Error(`Estado de vacante desconocido: ${String(status)}`);
  }
}
