import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/common/redis/redis.service';
import { LINKEDIN_APPLY_QUEUE } from '../queue/queue.constants';

/**
 * Poller genérico de cola Redis (RPOP).
 *
 * Saca trabajos de una lista Redis y los entrega a un handler.
 * Maneja el flag de procesamiento para evitar solapamiento.
 */
@Injectable()
export class QueuePoller {
  private readonly logger = new Logger(QueuePoller.name);
  private readonly POLL_INTERVAL_MS = 15_000; // 15s
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(private readonly redisService: RedisService) {}

  /**
   * Inicia el polling periódico.
   */
  start(handler: (raw: string) => Promise<void>): void {
    this.logger.log('[Queue] Poller started (every 15s).');
    this.timer = setInterval(() => {
      this.poll(handler).catch((error) => {
        this.logger.error(
          `[Queue] Poll error: ${error instanceof Error ? error.message : error}`,
        );
      });
    }, this.POLL_INTERVAL_MS);
  }

  /** true mientras se está procesando un trabajo de la cola. */
  isProcessing(): boolean {
    return this.processing;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Un ciclo de polling: saca un trabajo y lo pasa al handler.
   */
  private async poll(handler: (raw: string) => Promise<void>): Promise<void> {
    if (this.processing) {
      return;
    }

    const raw = await this.redisService.queuePop(LINKEDIN_APPLY_QUEUE);
    if (!raw) {
      return; // cola vacía o Redis no disponible
    }

    this.processing = true;
    try {
      await handler(raw);
    } finally {
      this.processing = false;
    }
  }
}