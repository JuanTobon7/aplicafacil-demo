
import { Injectable, Logger } from '@nestjs/common';
import { JobModel } from 'src/jobs/models/job.model';
import { RedisService } from 'src/common/redis/redis.service';
import { LINKEDIN_APPLY_QUEUE } from '../queue/queue.constants';
import { ApplyJobData } from './apply-job.types';

/**
 * Productor de la cola de aplicación de vacantes (lista Redis).
 *
 * Encola las vacantes pendientes (MATCHED) serializadas como JSON en la
 * lista `linkedin-apply` para que el procesador las aplique una a una.
 */
@Injectable()
export class JobApplyerQueue {
  private readonly logger = new Logger(JobApplyerQueue.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Encola una lista de vacantes para su aplicación, omitiendo las que ya
   * están en la cola (el cron re-encola cada 5 min y generaba duplicados).
   * Devuelve la cantidad de trabajos encolados.
   */
  async enqueueJobs(jobs: JobModel[]): Promise<number> {
    const queued = new Set(
      (await this.redisService.queuePeekAll(LINKEDIN_APPLY_QUEUE)).map(
        (raw) => this.jobIdOf(raw),
      ),
    );
    const fresh = jobs.filter((job) => {
      if (queued.has(job.id)) return false;
      queued.add(job.id);
      return true;
    });

    if (fresh.length === 0) {
      this.logger.debug('[Queue] All pending jobs are already queued.');
      return 0;
    }

    const payloads = fresh.map((job) =>
      JSON.stringify({
        jobId: job.id,
        url: job.url ?? '',
        title: job.title,
      } satisfies ApplyJobData),
    );

    const length = await this.redisService.queuePushMany(
      LINKEDIN_APPLY_QUEUE,
      payloads,
    );

    this.logger.log(
      `[Queue] Enqueued ${payloads.length} jobs for application (queue length: ${length ?? 0}).`,
    );
    return payloads.length;
  }

  /**
   * Reconstruye la cola desde cero con las vacantes dadas.
   * La BD es la fuente de verdad: descarta entradas viejas (vacantes ya
   * procesadas o eliminadas) y duplicados acumulados.
   */
  async rebuild(jobs: JobModel[]): Promise<number> {
    const stale = await this.getPendingCount();
    await this.redisService.del(LINKEDIN_APPLY_QUEUE);
    this.logger.log(`[Queue] Queue rebuilt (discarded ${stale} old entries).`);
    return this.enqueueJobs(jobs);
  }

  private jobIdOf(raw: string): string | null {
    try {
      return (JSON.parse(raw) as ApplyJobData).jobId;
    } catch {
      return null;
    }
  }

  /**
   * Devuelve la cantidad de trabajos pendientes en la cola.
   */
  async getPendingCount(): Promise<number> {
    return this.redisService.queueLength(LINKEDIN_APPLY_QUEUE);
  }
}