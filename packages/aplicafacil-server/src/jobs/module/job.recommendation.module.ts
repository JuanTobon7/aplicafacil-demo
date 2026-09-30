import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRecommendationController } from '../controller/job.recommendation.controller';
import { McpClientModule } from '../../mcp-client/mcp-client.module';
import { RedisModule } from '../../common/redis/redis.module';
import { NestLoggerAdapter } from '../../common/logger/nest-logger.adapter';
import { FillFormUseCase } from '@aplicafacil/core/application';
import {
  AI_COMPLETION_PORT,
  CACHE_PORT,
  LOGGER_PORT,
  type AiCompletionPort,
  type CachePort,
  type LoggerPort,
} from '@aplicafacil/core/application';
import { RedisService } from '../../common/redis/redis.service';

import { JobRecommendationService } from '../service/contract/job.recommendation.service';
import { JobRecommendationServiceImpl } from '../service/impl/job.recommendation.service';
import { JobsServiceImpl } from '../service/impl/jobs.service.impl';
import { ValidateJobsServiceImpl } from '../service/impl/validate-jobs.service.impl';
import { JobModel } from '../models/job.model';

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
      provide: CACHE_PORT,
      useExisting: RedisService,
    },
    {
      provide: LOGGER_PORT,
      useFactory: () => new NestLoggerAdapter('FillFormUseCase'),
    },
  ],
  exports: ['JobsService', 'ValidateJobsService', FillFormUseCase],
})
export class JobRecommendationModule {}
