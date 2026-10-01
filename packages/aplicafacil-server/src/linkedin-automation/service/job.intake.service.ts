import { Inject, Injectable, Logger } from '@nestjs/common';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { JobApplicationStatus } from 'src/jobs/enum/job-application-status';
import { JobsApplymentsMapper } from 'src/jobs/mapper/jobs-applyments.mapper';
import { JobModel } from 'src/jobs/models/job.model';
import { JobsService } from 'src/jobs/service/contract/jobs.service';
import { JobLifecycleService, ProfileForFit } from 'src/jobs/service/impl/job.lifecycle.service';
import { JobAutomationHelperService } from './job.automation.helper.service';

export interface IntakeSummary {
  found: number;
  /** Ya estaban guardadas (de búsquedas anteriores). */
  known: number;
  matched: number;
  skipped: number;
  /** No se pudieron evaluar (p.ej. embeddings caídos): quedan en DISCOVERED. */
  pending: number;
}

/**
 * Entrada de vacantes desde la búsqueda. Antes de dejarlas para postular,
 * la IA evalúa por embeddings si valen la pena:
 *
 *   nueva → DISCOVERED (+ idioma) → fit vacante↔perfil → MATCHED | SKIPPED
 *
 * Las SKIPPED también se guardan, para no re-evaluarlas en cada búsqueda.
 */
@Injectable()
export class JobIntakeService {
  private readonly logger = new Logger(JobIntakeService.name);

  constructor(
    @Inject('JobsService')
    private readonly jobsService: JobsService,
    private readonly lifecycle: JobLifecycleService,
    private readonly helper: JobAutomationHelperService,
  ) {}

  async intake(postings: JobPostingDto[], userId: string): Promise<IntakeSummary> {
    const summary: IntakeSummary = { found: postings.length, known: 0, matched: 0, skipped: 0, pending: 0 };
    const profile = await this.profileFor({ personId: userId, title: 'búsqueda' });

    // Las URLs de la búsqueda traen tracking: se comparan normalizadas
    const known = await this.jobsService.getAppliedExternalIds(userId);
    for (const posting of postings) {
      const url = posting.source?.url ? JobsApplymentsMapper.normalizeUrl(posting.source.url) : '';
      if (url && known.has(url)) {
        summary.known++;
        continue;
      }
      if (url) known.add(url);

      const job = await this.lifecycle.discover(posting, userId, profile?.id);
      this.count(summary, profile ? await this.lifecycle.evaluate(job, profile) : job);
    }

    this.logger.log(
      `[User ${userId}] Búsqueda: ${summary.found} encontradas, ${summary.known} ya conocidas → ` +
        `${summary.matched} para postular, ${summary.skipped} descartadas, ${summary.pending} por evaluar`,
    );
    return summary;
  }

  /**
   * Re-evalúa vacantes ya guardadas: las DISCOVERED que quedaron pendientes
   * y, si se pide, el backlog de MATCHED/SKIPPED (p.ej. tras cambiar el umbral).
   */
  async reevaluate(
    statuses: JobApplicationStatus[] = [JobApplicationStatus.DISCOVERED],
  ): Promise<IntakeSummary> {
    const jobs = (
      await Promise.all(statuses.map((status) => this.jobsService.getJobsByStatus(status)))
    ).flat();
    const summary: IntakeSummary = { found: jobs.length, known: 0, matched: 0, skipped: 0, pending: 0 };

    const profiles = new Map<string, ProfileForFit | null>();
    for (const job of jobs) {
      const key = job.profileId ?? job.personId ?? '';
      if (!profiles.has(key)) profiles.set(key, await this.profileFor(job));
      const profile = profiles.get(key);
      this.count(summary, profile ? await this.lifecycle.evaluate(job, profile) : job);
    }

    if (jobs.length > 0) {
      this.logger.log(
        `Re-evaluadas ${jobs.length} vacantes (${statuses.join(', ')}) → ` +
          `${summary.matched} para postular, ${summary.skipped} descartadas, ${summary.pending} por evaluar`,
      );
    }
    return summary;
  }

  private async profileFor(
    job: Pick<JobModel, 'profileId' | 'personId' | 'title'>,
  ): Promise<ProfileForFit | null> {
    const profile = await this.helper.resolveProfile(job);
    if (!profile) {
      this.logger.warn('Sin perfil del candidato: las vacantes quedan en DISCOVERED sin evaluar');
      return null;
    }
    return { id: profile.id, text: this.helper.profileFitText(profile) };
  }

  private count(summary: IntakeSummary, job: JobModel | null): void {
    if (job?.status === JobApplicationStatus.MATCHED) summary.matched++;
    else if (job?.status === JobApplicationStatus.SKIPPED) summary.skipped++;
    else summary.pending++;
  }
}
