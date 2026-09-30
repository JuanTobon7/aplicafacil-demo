import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueuePoller } from './queue.poller';
import { JobProcessor } from './job.processor';
import { RetryHandler } from './retry.handler';
import { ApplyJobData } from './apply-job.types';
import { JobApplyerQueue } from './job.applyer.queu';
import { ScrapingLinkldnService } from '../service/contract/scraping.linkldn.service';

/**
 * Orquestador del procesador de la cola `linkedin-apply`.
 *
 * Coordina tres componentes especializados:
 * - QueuePoller: polling de la cola Redis (RPOP)
 * - JobProcessor: lógica de negocio (claim → apply → mark)
 * - RetryHandler: reintentos con backoff (máx. 3)
 */
@Injectable()
export class ApplyJobProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApplyJobProcessor.name);

  constructor(
    private readonly poller: QueuePoller,
    private readonly jobProcessor: JobProcessor,
    private readonly retryHandler: RetryHandler,
    private readonly jobApplyerQueue: JobApplyerQueue,
    @Inject('ScrapingLinkldnService')
    private readonly scrapingLinkldnService: ScrapingLinkldnService,
  ) {}

  onModuleInit(): void {
    this.poller.start((raw) => this.handleJob(raw));
  }

  onModuleDestroy(): void {
    this.poller.stop();
  }

  /**
   * Procesa un trabajo crudo de la cola: lo parsea y lo delega al JobProcessor.
   * Si falla, delega al RetryHandler.
   */
  private async handleJob(raw: string): Promise<void> {
    let data: ApplyJobData | undefined;
    try {
      data = this.parseJob(raw);
      await this.jobProcessor.process(data);
    } catch (error) {
      this.logger.error(
        `[Queue] Error processing job: ${error instanceof Error ? error.message : error}`,
      );
      // Re-encolar para reintentar (máx. 3 intentos) solo si el parseo fue exitoso
      if (data) {
        await this.retryHandler.retry(data);
      }
    } finally {
      await this.releaseTabIfIdle();
    }
  }

  /**
   * El worker terminó cuando la cola quedó vacía: cierra su pestaña (y el
   * navegador, si el cron no tiene la suya abierta). Si quedan trabajos, la
   * pestaña se conserva para el siguiente.
   */
  private async releaseTabIfIdle(): Promise<void> {
    try {
      if ((await this.jobApplyerQueue.getPendingCount()) > 0) return;
      this.logger.log('[Queue] Queue drained. Releasing apply tab.');
      await this.scrapingLinkldnService.releaseTab('apply');
    } catch (error) {
      this.logger.warn(
        `[Queue] Could not release apply tab: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Convierte el JSON crudo de la cola en un trabajo tipado.
   */
  private parseJob(raw: string): ApplyJobData {
    return JSON.parse(raw) as ApplyJobData;
  }
}