import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScrapingLinkldnService } from '../service/contract/scraping.linkldn.service';
import { JobLifecycleService } from 'src/jobs/service/impl/job.lifecycle.service';
import { JobAutomationHelperService } from '../service/job.automation.helper.service';
import { JobModel } from 'src/jobs/models/job.model';
import { ApplyJobData } from './apply-job.types';
import { DryRunStopError } from '../components/easy-apply/contract/easy.apply.component';

/**
 * Procesa un trabajo individual: claim → apply → mark as applied.
 *
 * Los cambios de estado pasan por el patrón State (JobLifecycleService):
 * MATCHED → APPLYING → APPLIED | APPLICATION_FAILED.
 */
@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    @Inject('ScrapingLinkldnService')
    private readonly scrapingLinkldnService: ScrapingLinkldnService,
    private readonly lifecycle: JobLifecycleService,
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
      await this.markAsApplied(claimed, title);
    } catch (error) {
      if (error instanceof DryRunStopError) {
        // Dry run: el formulario quedó listo pero no se envió → vuelve a la cola
        this.logger.warn(`[Queue] ${error.message}`);
        await this.lifecycle.recover(claimed, error.message);
        return;
      }
      // La aplicación falló (sin botón Easy Apply, formulario no enviado, etc.)
      // NO marcar APPLIED. Marcar APPLICATION_FAILED para no re-procesar.
      this.logger.error(
        `[Queue] Application failed for ${title}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      await this.lifecycle.failed(
        claimed,
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
    const claimed = await this.lifecycle.claim(jobId);

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
    const posting = await this.helper.toApplication(job);
    await this.scrapingLinkldnService.resolveFillFormAndApply(posting);
  }

  /**
   * Marca la vacante como APPLIED tras una aplicación exitosa.
   */
  private async markAsApplied(job: JobModel, title: string): Promise<void> {
    await this.lifecycle.applied(job, 'Auto-aplicación completada (cola)');
    this.logger.log(`[Queue] Successfully applied to: ${title}`);
  }
}