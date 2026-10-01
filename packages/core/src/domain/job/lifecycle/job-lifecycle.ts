import {
  JobFitEvaluation,
  JobLanguage,
  JobLanguageInfo,
  JobMetadata,
  JobStatus,
} from './job-metadata.js';
import { DiscoveredState, JobState, stateFor } from './job-state.js';

/** Transiciones que se conservan en la metadata. */
const MAX_HISTORY = 30;

/**
 * Contexto del patrón State: la vacante con su estado actual y su metadata
 * (idioma, evaluación de fit, historial). Cada evento se delega al estado
 * actual, que devuelve el siguiente o lanza InvalidJobTransitionError.
 *
 * Es puro dominio: quien lo use persiste `status` y `metadata` después.
 */
export class JobLifecycle {
  private constructor(
    private state: JobState,
    private data: JobMetadata,
  ) {}

  /** Vacante nueva encontrada en la búsqueda. */
  static discover(language?: JobLanguageInfo): JobLifecycle {
    const lifecycle = new JobLifecycle(new DiscoveredState(), { language, history: [] });
    lifecycle.record(null, JobStatus.DISCOVERED, 'Encontrada en la búsqueda');
    return lifecycle;
  }

  /** Reconstruye el contexto desde lo guardado en la BD. */
  static restore(status: JobStatus, metadata?: Partial<JobMetadata> | null): JobLifecycle {
    return new JobLifecycle(stateFor(status), {
      ...metadata,
      history: metadata?.history ?? [],
    });
  }

  get status(): JobStatus {
    return this.state.status;
  }

  get metadata(): JobMetadata {
    return { ...this.data, history: [...this.data.history] };
  }

  get language(): JobLanguage {
    return this.data.language?.code ?? 'unknown';
  }

  setLanguage(language: JobLanguageInfo): void {
    this.data.language = language;
  }

  evaluate(fit: JobFitEvaluation): void {
    this.data.fit = fit;
    delete this.data.evaluationError;
    const verdict = fit.worthApplying ? '≥' : '<';
    this.apply(
      this.state.evaluate(fit),
      `Fit por embeddings ${fit.score.toFixed(3)} ${verdict} umbral ${fit.threshold}`,
    );
  }

  /** La evaluación no se pudo hacer: no cambia de estado, queda para re-evaluar. */
  evaluationFailed(message: string): void {
    this.data.evaluationError = { message, at: new Date().toISOString() };
  }

  startApplying(): void {
    this.apply(this.state.startApplying(), 'Reclamada por el worker de postulación');
  }

  applied(reason?: string): void {
    this.apply(this.state.applied(), reason);
  }

  failed(reason: string): void {
    this.apply(this.state.failed(), reason);
  }

  recover(reason: string): void {
    this.apply(this.state.recover(), reason);
  }

  reject(reason?: string): void {
    this.apply(this.state.reject(), reason);
  }

  private apply(next: JobState, reason?: string): void {
    const from = this.state.status;
    this.state = next;
    this.record(from, next.status, reason);
  }

  private record(from: JobStatus | null, to: JobStatus, reason?: string): void {
    this.data.history.push({ from, to, at: new Date().toISOString(), reason });
    if (this.data.history.length > MAX_HISTORY) {
      this.data.history.splice(0, this.data.history.length - MAX_HISTORY);
    }
  }
}
