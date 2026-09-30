import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'puppeteer';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { EasyApplyComponent } from '../contract/easy.apply.component';
import { EasyApplyButtonClicker } from '../contract/easy.apply.button.clicker';
import { HumanBehaviorService } from '../../../common/human-behavior.service';
import {
  AiFormContext,
  AiFormFiller,
  AiFormOutcome,
} from '../../ai-form/contract/ai.form.filler';

/** Contenedor del formulario de Easy Apply de LinkedIn. */
const EASY_APPLY_ROOT = '.jobs-easy-apply-modal';

/**
 * Busca el botón "Solicitar"/"Apply" de una oferta con aplicación EXTERNA
 * (no Easy Apply), lo marca con `data-af-external` y devuelve si lo encontró.
 * Autocontenida: se ejecuta dentro del navegador.
 */
function markExternalApplyButton(): boolean {
  const candidates = Array.from(
    document.querySelectorAll('button, a[role="button"], [role="button"], a'),
  );
  const button = candidates.find((b) => {
    const text = `${(b as HTMLElement).innerText ?? ''} ${b.getAttribute('aria-label') ?? ''}`
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return (
      /^(solicitar|apply|aplicar)\b/.test(text) &&
      !text.includes('sencilla') &&
      !text.includes('easy apply')
    );
  });
  if (!button) return false;
  button.setAttribute('data-af-external', '1');
  return true;
}

@Injectable()
export class EasyApplyComponentImpl implements EasyApplyComponent {
  private readonly logger = new Logger(EasyApplyComponentImpl.name);

  constructor(
    private readonly buttonClicker: EasyApplyButtonClicker,
    private readonly aiFormFiller: AiFormFiller,
    private readonly human: HumanBehaviorService,
  ) {}

  async apply(page: Page, job: JobPostingDto): Promise<void> {
    this.logger.log(`Applying to: ${job.job.title}`);

    // NOTA: 'domcontentloaded' en lugar de 'networkidle2' (LinkedIn mantiene
    // conexiones persistentes que impiden alcanzar 'idle' en la red).
    await page.goto(job.source.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Pausa humana tras cargar la oferta antes de interactuar.
    await this.human.wait();

    const ctx = this.toContext(job);
    const outcome = (await this.tryEasyApply(page))
      ? await this.aiFormFiller.fillUntilDone(page, EASY_APPLY_ROOT, ctx)
      : await this.applyExternally(page, ctx);

    this.logOutcome(job, outcome);

    if (!outcome.submitted) {
      throw new Error(
        `Application for ${job.job.title} was not submitted: ${outcome.reason ?? 'unknown reason'}`,
      );
    }
  }

  /** Abre el modal de Easy Apply. false si la oferta no tiene Easy Apply. */
  private async tryEasyApply(page: Page): Promise<boolean> {
    try {
      if (!(await this.buttonClicker.click(page))) return false;
      await page.waitForSelector(EASY_APPLY_ROOT, { timeout: 30_000 });
      await this.human.wait();
      return true;
    } catch {
      this.logger.log('No Easy Apply available, trying external application');
      return false;
    }
  }

  /**
   * Aplicación externa: pulsa "Solicitar", toma la pestaña que abre LinkedIn
   * (o la misma página si navega) y recorre el formulario del sitio externo.
   */
  private async applyExternally(page: Page, ctx: AiFormContext): Promise<AiFormOutcome> {
    if (!(await page.evaluate(markExternalApplyButton))) {
      throw new Error('No apply button found (neither Easy Apply nor external).');
    }
    const button = await page.$('[data-af-external]');
    if (!button) throw new Error('External apply button disappeared.');

    const newTab = page
      .browser()
      .waitForTarget((t) => t.opener() === page.target(), { timeout: 15_000 })
      .then((t) => t.page())
      .catch(() => null);

    await this.human.clickElement(button);
    const externalPage = (await newTab) ?? page;
    this.logger.log(`External application at ${externalPage.url()}`);

    try {
      await externalPage.bringToFront();
      await externalPage
        .waitForSelector('input, textarea, select, button', { timeout: 30_000 })
        .catch(() => undefined);
      await this.human.wait();
      return await this.aiFormFiller.fillUntilDone(externalPage, 'body', ctx);
    } finally {
      if (externalPage !== page) {
        await externalPage.close().catch(() => undefined);
        await page.bringToFront();
      }
    }
  }

  private toContext(job: JobPostingDto): AiFormContext {
    if (!job.profileId && !job.personId) {
      this.logger.warn(
        `Job "${job.job.title}" has no profileId/personId: the AI won't have candidate data`,
      );
    }
    return {
      url: job.source.url,
      title: job.job.title,
      metadata: {
        title: job.metadata?.title ?? job.job.title,
        company: job.metadata?.company ?? job.company?.name ?? '',
        location: job.metadata?.location ?? job.location?.rawLocation ?? '',
        description: job.metadata?.description ?? job.job.description ?? '',
        workplaceType: job.metadata?.workplaceType,
        employmentType: job.metadata?.employmentType,
        url: job.source.url,
      },
      profileId: job.profileId,
      personId: job.personId,
    };
  }

  private logOutcome(job: JobPostingDto, outcome: AiFormOutcome): void {
    this.logger.log(
      `${job.job.title}: submitted=${outcome.submitted} steps=${outcome.steps}` +
        (outcome.reason ? ` reason="${outcome.reason}"` : ''),
    );
    if (outcome.pendingReview.length) {
      this.logger.warn(`Fields flagged for review: ${outcome.pendingReview.join(', ')}`);
    }
    if (outcome.skipped.length) {
      this.logger.warn(`Fields left empty by the AI: ${outcome.skipped.join(', ')}`);
    }
  }
}
