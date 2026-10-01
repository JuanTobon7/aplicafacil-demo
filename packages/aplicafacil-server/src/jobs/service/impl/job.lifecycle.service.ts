import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvaluateJobFitUseCase } from '@aplicafacil/core/application';
import {
  JobFitEvaluation,
  JobLifecycle,
  JobStatus,
  detectLanguage,
} from '@aplicafacil/core/domain';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { JobModel } from 'src/jobs/models/job.model';
import { JobsApplymentsMapper } from 'src/jobs/mapper/jobs-applyments.mapper';

/** Perfil del candidato en texto, listo para embeddings. */
export interface ProfileForFit {
  id: string;
  text: string;
}

/**
 * Persistencia del patrón State de la vacante (JobLifecycle del core).
 *
 * Cada transición: reconstruye el contexto desde la fila (status + metadata),
 * aplica el evento (el estado actual decide si es válido) y guarda con un
 * UPDATE condicionado al estado previo, así dos workers no pisan la misma
 * vacante. Devuelve null si otro proceso la cambió primero.
 */
@Injectable()
export class JobLifecycleService {
  private readonly logger = new Logger(JobLifecycleService.name);

  constructor(
    @InjectRepository(JobModel)
    private readonly jobsRepo: Repository<JobModel>,
    private readonly evaluateFit: EvaluateJobFitUseCase,
  ) {}

  /** Guarda una vacante nueva en DISCOVERED con su idioma detectado. */
  async discover(
    posting: JobPostingDto,
    userId: string,
    profileId?: string,
  ): Promise<JobModel> {
    const entity = JobsApplymentsMapper.fromJobPosting(posting);
    const lifecycle = JobLifecycle.discover(
      detectLanguage(`${posting.job.title}\n${posting.job.description ?? ''}`),
    );
    entity.personId = userId;
    entity.profileId = profileId;
    entity.status = lifecycle.status;
    entity.metadata = lifecycle.metadata;
    return this.jobsRepo.save(entity);
  }

  /**
   * La IA evalúa por embeddings si vale la pena postular → MATCHED o SKIPPED.
   * Si el proveedor de embeddings falla, la vacante NO cambia de estado (queda
   * para re-evaluar) y el error se anota en la metadata.
   */
  async evaluate(job: JobModel, profile: ProfileForFit): Promise<JobModel | null> {
    const lifecycle = this.restore(job);
    // Vacantes guardadas antes de existir la metadata: se completa el idioma
    if (!job.metadata?.language) lifecycle.setLanguage(languageOf(job));

    let fit: JobFitEvaluation;
    try {
      fit = await this.evaluateFit.execute({ jobText: jobFitText(job), profile });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lifecycle.evaluationFailed(message);
      this.logger.warn(`Fit de "${job.title}" pendiente: ${message}`);
      return this.save(job, lifecycle);
    }

    lifecycle.evaluate(fit);
    this.logger.log(
      `Fit "${job.title}" [${lifecycle.language}] = ${fit.score.toFixed(3)} → ${lifecycle.status}`,
    );
    return this.save(job, lifecycle);
  }

  /** MATCHED → APPLYING. Null si ya no está MATCHED (otro worker la tomó). */
  async claim(jobId: string): Promise<JobModel | null> {
    const job = await this.jobsRepo.findOneBy({ id: jobId });
    if (!job || job.status !== JobStatus.MATCHED) return null;
    return this.transition(job, (lc) => {
      // Vacantes guardadas antes de existir la metadata: se completa el idioma
      if (!job.metadata?.language) lc.setLanguage(languageOf(job));
      lc.startApplying();
    });
  }

  applied(job: JobModel, reason: string): Promise<JobModel | null> {
    return this.transition(job, (lc) => lc.applied(reason));
  }

  failed(job: JobModel, reason: string): Promise<JobModel | null> {
    return this.transition(job, (lc) => lc.failed(reason));
  }

  recover(job: JobModel, reason: string): Promise<JobModel | null> {
    return this.transition(job, (lc) => lc.recover(reason));
  }

  restore(job: JobModel): JobLifecycle {
    return JobLifecycle.restore(job.status, job.metadata);
  }

  private transition(
    job: JobModel,
    event: (lifecycle: JobLifecycle) => void,
  ): Promise<JobModel | null> {
    const lifecycle = this.restore(job);
    event(lifecycle); // lanza InvalidJobTransitionError si el estado no lo permite
    return this.save(job, lifecycle);
  }

  private async save(job: JobModel, lifecycle: JobLifecycle): Promise<JobModel | null> {
    const metadata = lifecycle.metadata;
    const last = metadata.history.at(-1);
    const set: Partial<JobModel> = { status: lifecycle.status, metadata };
    if (lifecycle.status !== job.status && last?.reason) set.statusReason = last.reason;
    if (lifecycle.status === JobStatus.APPLIED) set.appliedAt = new Date();

    const result = await this.jobsRepo
      .createQueryBuilder()
      .update(JobModel)
      .set(set as never)
      .where('id = :id AND status = :status', { id: job.id, status: job.status })
      .returning('*')
      .execute();

    const raw = (result.raw as JobModel[] | undefined)?.[0];
    if (!raw) {
      this.logger.warn(
        `Vacante ${job.id} ya no está en ${job.status}: transición a ${lifecycle.status} descartada`,
      );
      return null;
    }
    return this.jobsRepo.create(raw);
  }
}

function languageOf(job: JobModel) {
  return detectLanguage(`${job.title}\n${job.description ?? ''}`);
}

/** Texto de la vacante para el embedding. */
function jobFitText(job: JobModel): string {
  return [job.title, job.company, job.location, job.description].filter(Boolean).join('\n');
}
