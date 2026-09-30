import { Module } from '@nestjs/common';
import { BrowserManager } from './browser-manager/contract/browser.manager';
import { BrowserManagerImpl } from './browser-manager/impl/browser.manager.impl';
import { LinkedInLoginComponent } from './login/contract/linkedin.login.component';
import { LinkedInLoginComponentImpl } from './login/impl/linkedin.login.component.impl';
import { JobSearchComponent } from './job-search/contract/job.search.component';
import { JobSearchComponentImpl } from './job-search/impl/job.search.component.impl';
import { JobDetailExtractorComponent } from './job-detail/contract/job.detail.extractor.component';
import { JobDetailExtractorComponentImpl } from './job-detail/impl/job.detail.extractor.component.impl';
import { EasyApplyComponent } from './easy-apply/contract/easy.apply.component';
import { EasyApplyComponentImpl } from './easy-apply/impl/easy.apply.component.impl';
import { EasyApplyButtonClicker } from './easy-apply/contract/easy.apply.button.clicker';
import { EasyApplyButtonClickerImpl } from './easy-apply/impl/easy.apply.button.clicker.impl';
import { AiFormFiller } from './ai-form/contract/ai.form.filler';
import { AiFormFillerImpl } from './ai-form/impl/ai.form.filler.impl';
import { JobRecommendationModule } from '../../jobs/module/job.recommendation.module';
import { CaptchaDetector } from './captcha/contract/captcha.detector';
import { CaptchaDetectorImpl } from './captcha/impl/captcha.detector.impl';
import { SessionStore } from './session-store/contract/session.store';
import { SessionStoreImpl } from './session-store/impl/session.store.impl';
import { HumanBehaviorService } from '../common/human-behavior.service';

@Module({
  // FillFormUseCase (IA + tools MCP) para llenar formularios de postulación
  imports: [JobRecommendationModule],
  providers: [
    HumanBehaviorService,
    {
      provide: CaptchaDetector,
      useClass: CaptchaDetectorImpl,
    },
    {
      provide: SessionStore,
      useClass: SessionStoreImpl,
    },
    {
      provide: BrowserManager,
      useClass: BrowserManagerImpl,
    },
    {
      provide: LinkedInLoginComponent,
      useClass: LinkedInLoginComponentImpl,
    },
    {
      provide: JobSearchComponent,
      useClass: JobSearchComponentImpl,
    },
    {
      provide: JobDetailExtractorComponent,
      useClass: JobDetailExtractorComponentImpl,
    },
    {
      provide: EasyApplyComponent,
      useClass: EasyApplyComponentImpl,
    },
    {
      provide: EasyApplyButtonClicker,
      useClass: EasyApplyButtonClickerImpl,
    },
    {
      provide: AiFormFiller,
      useClass: AiFormFillerImpl,
    },
  ],
  exports: [
    BrowserManager,
    LinkedInLoginComponent,
    JobSearchComponent,
    JobDetailExtractorComponent,
    EasyApplyComponent,
    CaptchaDetector,
    SessionStore,
    HumanBehaviorService,
    AiFormFiller,
  ],
})
export class LinkedInComponentsModule {}