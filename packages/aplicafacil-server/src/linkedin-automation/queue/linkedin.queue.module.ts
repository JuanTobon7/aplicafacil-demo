import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileModel } from '../../profiles/models/profiles.model';
import { ApplyJobProcessor } from '../worker/apply-job.processor';
import { JobApplyerQueue } from '../worker/job.applyer.queu';
import { QueuePoller } from '../worker/queue.poller';
import { JobProcessor } from '../worker/job.processor';
import { RetryHandler } from '../worker/retry.handler';
import { RedisModule } from '../../common/redis/redis.module';
import { LinkedInComponentsModule } from '../components/linkedin.components.module';
import { JobRecommendationModule } from '../../jobs/module/job.recommendation.module';
import { PeopleModule } from '../../people/module/people.module';
import { ScrapingLinkldnServiceImpl } from '../service/impl/scraping/scraping.linkldn.service.impl';
import { JobAutomationHelperService } from '../service/job.automation.helper.service';

/**
 * Cola de aplicación de vacantes basada en Redis (listas LPUSH/RPOP).
 *
 * Usa el RedisService existente (con degradación silenciosa): si Redis
 * no está disponible, las operaciones de cola no lanzan excepciones y
 * el sistema continúa funcionando.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProfileModel]),
    RedisModule,
    LinkedInComponentsModule,
    JobRecommendationModule,
    PeopleModule,
  ],
  providers: [
    JobApplyerQueue,
    ApplyJobProcessor,
    QueuePoller,
    JobProcessor,
    RetryHandler,
    {
      provide: 'ScrapingLinkldnService',
      useClass: ScrapingLinkldnServiceImpl,
    },
    JobAutomationHelperService,
  ],
  exports: [
    JobApplyerQueue,
    QueuePoller,
    'ScrapingLinkldnService',
    JobAutomationHelperService,
  ],
})
export class LinkedinQueueModule {}