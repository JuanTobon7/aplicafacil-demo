import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScrapingLinkldnService } from '../service/contract/scraping.linkldn.service';
import { JobsService } from 'src/jobs/service/contract/jobs.service';
import { JobApplicationStatus } from 'src/jobs/enum/job-application-status';
import { JobAutomationHelperService } from '../service/job.automation.helper.service';
import { JobModel } from 'src/jobs/models/job.model';
import { ApplyJobData } from './apply-job.types';

/**
 * Procesa un trabajo individual: claim → apply → mark as applied.
 *
 * Encapsula la lógica de negocio de aplicar a una vacante.
 */
@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    @Inject('ScrapingLinkldnService')
    private readonly scrapingLinkldnService: ScrapingLinkldnService,
    @Inject('JobsService')
    private readonly jobsService: JobsService,
    private readonly helper: JobAutomationHelperService,
  ) {}

  /**
   * Procesa un trabajo completo: claim → apply → mark as applied.
   * Lanza excepción si falla (para que el retry handler la capture).
   */
  async process(data: ApplyJobData): Promise<void> {
    const { jobId, url, title } = data;
    this.logger.log(`[Queue] Processing job: ${title} (${url})`);
    await this.scrapingLinkldnService.openLinkdlnProfile(
      this.helper.getCredentialsLinkdln(),
    );
    const claimed = await this.claimJob(jobId, title);
    if (!claimed) {
      return; // otro worker ya lo tomó
    }

    try {
      await this.applyToJob(claimed);
      await this.markAsApplied(claimed.id, title);
    } catch (error) {
      // La aplicación falló (sin botón Easy Apply, formulario no enviado, etc.)
      // NO marcar APPLIED. Marcar APPLICATION_FAILED para no re-procesar.
      this.logger.error(
        `[Queue] Application failed for ${title}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      await this.jobsService.updateStatusJob(
        claimed.id,
        JobApplicationStatus.APPLICATION_FAILED,
        `Auto-aplicación falló: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Claim atómico: transiciona MATCHED → APPLYING solo si nadie más lo tomó.
   * Devuelve null si otro worker ya reclamó la vacante.
   */
  private async claimJob(
    jobId: string,
    title: string,
  ): Promise<JobModel | null> {
    const claimed = await this.jobsService.claimJob(
      jobId,
      JobApplicationStatus.MATCHED,
      JobApplicationStatus.APPLYING,
      { automationUserId: 'queue-worker' },
    );

    if (!claimed) {
      this.logger.warn(
        `[Queue] Job ${title} is no longer MATCHED (already processed, in progress or deleted). Discarded.`,
      );
    }

    return claimed;
  }

  /**
   * Ejecuta el flujo de Easy Apply sobre la vacante reclamada.
   */
  private async applyToJob(job: JobModel): Promise<void> {
    const posting = this.helper.toJobPosting(job);
    posting.resumePath = await this.helper.resolveResumePath(job);
    await this.scrapingLinkldnService.resolveFillFormAndApply(posting);
  }

  /**
   * Marca la vacante como APPLIED tras una aplicación exitosa.
   */
  private async markAsApplied(jobId: string, title: string): Promise<void> {
    await this.jobsService.updateStatusJob(
      jobId,
      JobApplicationStatus.APPLIED,
      'Auto-aplicación completada (cola)',
    );
    this.logger.log(`[Queue] Successfully applied to: ${title}`);
  }
}