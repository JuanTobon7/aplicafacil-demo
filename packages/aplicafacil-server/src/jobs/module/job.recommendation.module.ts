import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRecommendationController } from '../controller/job.recommendation.controller';
import { McpClientModule } from '../../mcp-client/mcp-client.module';
import { RedisModule } from '../../common/redis/redis.module';
import { NestLoggerAdapter } from '../../common/logger/nest-logger.adapter';
import {
  DecideFormStepUseCase,
  EvaluateJobFitUseCase,
  FillFormUseCase,
} from '@aplicafacil/core/application';
import {
  AI_COMPLETION_PORT,
  CACHE_PORT,
  EMBEDDING_PORT,
  LOGGER_PORT,
  type AiCompletionPort,
  type CachePort,
  type EmbeddingPort,
  type LoggerPort,
} from '@aplicafacil/core/application';
import { RedisService } from '../../common/redis/redis.service';

import { JobRecommendationService } from '../service/contract/job.recommendation.service';
import { JobRecommendationServiceImpl } from '../service/impl/job.recommendation.service';
import { JobsServiceImpl } from '../service/impl/jobs.service.impl';
import { ValidateJobsServiceImpl } from '../service/impl/validate-jobs.service.impl';
import { JobModel } from '../models/job.model';
import { JobLifecycleService } from '../service/impl/job.lifecycle.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    McpClientModule,
    RedisModule,
    TypeOrmModule.forFeature([JobModel]),
  ],
  controllers: [JobRecommendationController],
  providers: [
    {
      provide: JobRecommendationService,
      useClass: JobRecommendationServiceImpl,
    },
    {
      provide: 'JobsService',
      useClass: JobsServiceImpl,
    },
    {
      provide: 'ValidateJobsService',
      useClass: ValidateJobsServiceImpl,
    },
    {
      provide: FillFormUseCase,
      inject: [AI_COMPLETION_PORT, CACHE_PORT, LOGGER_PORT, ConfigService],
      useFactory: (
        ai: AiCompletionPort,
        cache: CachePort,
        logger: LoggerPort,
        config: ConfigService,
      ) =>
        new FillFormUseCase(
          ai,
          cache,
          logger,
          Number(config.get<string>('REDIS_ETAG_TTL')) || 3600,
        ),
    },
    {
      // Loop paso a paso del scraper: la IA devuelve acciones por id
      provide: DecideFormStepUseCase,
      inject: [AI_COMPLETION_PORT],
      useFactory: (ai: AiCompletionPort) =>
        new DecideFormStepUseCase(ai, new NestLoggerAdapter(DecideFormStepUseCase.name)),
    },
    {
      // ¿Vale la pena la vacante? Similitud coseno vacante ↔ perfil
      provide: EvaluateJobFitUseCase,
      inject: [EMBEDDING_PORT, CACHE_PORT, ConfigService],
      useFactory: (embeddings: EmbeddingPort, cache: CachePort, config: ConfigService) =>
        new EvaluateJobFitUseCase(
          embeddings,
          cache,
          new NestLoggerAdapter(EvaluateJobFitUseCase.name),
          {
            threshold: Number(config.get<string>('JOB_FIT_THRESHOLD')) || 0.4,
            model: embeddingModelName(config),
          },
        ),
    },
    JobLifecycleService,
    {
      provide: CACHE_PORT,
      useExisting: RedisService,
    },
    {
      provide: LOGGER_PORT,
      useFactory: () => new NestLoggerAdapter('FillFormUseCase'),
    },
  ],
  exports: [
    'JobsService',
    'ValidateJobsService',
    FillFormUseCase,
    DecideFormStepUseCase,
    JobLifecycleService,
  ],
})
export class JobRecommendationModule {}

/** "proveedor:modelo" de embeddings: los scores solo son comparables con el mismo. */
function embeddingModelName(config: ConfigService): string {
  const provider = (
    config.get<string>('EMBEDDING_PROVIDER') ??
    config.get<string>('LLM_PROVIDER') ??
    'openrouter'
  )
    .split(',')[0]
    .trim()
    .toLowerCase();
  const model =
    provider === 'omniroute'
      ? config.get<string>('OMNIROUTE_EMBEDDING_MODEL')
      : config.get<string>('OPENROUTER_EMBEDDING_MODEL');
  return `${provider}:${model ?? 'default'}`;
}
