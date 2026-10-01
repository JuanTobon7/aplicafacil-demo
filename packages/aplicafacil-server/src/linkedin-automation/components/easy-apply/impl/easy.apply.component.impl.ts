import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'puppeteer';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { DryRunStopError, EasyApplyComponent } from '../contract/easy.apply.component';
import { EasyApplyButtonClicker } from '../contract/easy.apply.button.clicker';
import { HumanBehaviorService } from '../../../common/human-behavior.service';
import {
  AiFormContext,
  AiFormFiller,
  AiFormOutcome,
} from '../../ai-form/contract/ai.form.filler';

/**
 * Detecta dónde quedó el formulario interno de LinkedIn tras pulsar Easy Apply
 * y devuelve su selector (o null si aún no aparece). LinkedIn tiene varias
 * variantes: modal clásico, modal nuevo, diálogo genérico o el flujo SDUI que
 * navega a /apply/?openSDUIApplyFlow=true como página completa.
 * Autocontenida: se ejecuta dentro del navegador.
 */
function detectEasyApplyRoot(): string | null {
  // Busca también dentro de shadow DOM abiertos (LinkedIn monta el modal de
  // Easy Apply dentro de un shadowRoot, invisible para document.querySelector).
  const shadowScopes: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < shadowScopes.length; i++) {
    shadowScopes[i].querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) shadowScopes.push(el.shadowRoot);
    });
  }
  const deepQuery = (sel: string): Element | null => {
    for (const s of shadowScopes) {
      const found = s.querySelector(sel);
      if (found) return found;
    }
    return null;
  };
  // Un modal recién abierto ya trae "Descartar" antes de pintar el formulario:
  // solo cuenta si tiene campos o un botón para avanzar/enviar.
  const actionRe = /siguiente|next|continuar|continue|revisar|review|enviar|submit/i;
  const hasForm = (el: Element) =>
    (el as HTMLElement).getClientRects().length > 0 &&
    (!!el.querySelector('input:not([type="hidden"]), select, textarea') ||
      Array.from(el.querySelectorAll('button')).some((b) =>
        actionRe.test(`${b.innerText} ${b.getAttribute('aria-label') ?? ''}`),
      ));

  const selectors = [
    // Diseño SDUI (2026): <dialog open data-testid="dialog"> nativo con la
    // pantalla data-sdui-screen="…jobs.easyapply.EasyApply" dentro.
    'dialog[open]:has([data-sdui-screen*="EasyApply"])',
    'dialog[open]',
    '.jobs-easy-apply-modal',
    '[data-test-modal-id="easy-apply-modal"]',
    '.jobs-easy-apply-content',
    '[role="dialog"]',
  ];
  for (const selector of selectors) {
    const el = deepQuery(selector);
    if (el && hasForm(el)) return selector;
  }

  if (/\/apply\//.test(location.pathname) || location.search.includes('openSDUIApplyFlow')) {
    const main = deepQuery('main');
    if (main && hasForm(main)) return 'main';
  }
  return null;
}

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

type EasyApplyStart =
  | { kind: 'internal'; root: string }
  | { kind: 'external'; page: Page }
  | { kind: 'none' };

function isLinkedInUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('linkedin.com');
  } catch {
    return true;
  }
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
    // NOTA: 'domcontentloaded' en lugar de 'networkidle2' (LinkedIn mantiene
    // conexiones persistentes que impiden alcanzar 'idle' en la red).
    await page.goto(job.source.url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Pausa humana tras cargar la oferta antes de interactuar.
    await this.human.wait();

    const ctx = this.toContext(job);
    const start = await this.startEasyApply(page);

    let outcome: AiFormOutcome;
    switch (start.kind) {
      case 'internal':
        outcome = await this.aiFormFiller.fillUntilDone(page, start.root, ctx);
        break;
      case 'external':
        // El botón pulsado resultó ser una aplicación externa (p.ej. ATS)
        outcome = await this.fillExternal(page, start.page, ctx);
        break;
      case 'none':
        outcome = await this.applyExternally(page, ctx);
        break;
    }

    this.logOutcome(job, outcome);

    if (outcome.dryRunStopped) {
      throw new DryRunStopError(`${job.job.title}: ${outcome.reason}`);
    }
    if (!outcome.submitted) {
      throw new Error(
        `Application for ${job.job.title} was not submitted: ${outcome.reason ?? 'unknown reason'}`,
      );
    }
  }

  /**
   * Pulsa Easy Apply y observa qué pasa:
   * - aparece el formulario interno → `internal` con su contenedor;
   * - se abre otra pestaña o la página sale de LinkedIn → `external`
   *   (el botón era de una aplicación externa, p.ej. SmartRecruiters);
   * - no hay botón de Easy Apply → `none` (se busca "Solicitar" externo).
   */
  private async startEasyApply(page: Page): Promise<EasyApplyStart> {
    const newTab = this.waitForNewTab(page, 30_000);

    let clicked = false;
    try {
      clicked = await this.buttonClicker.click(page);
    } catch {
      clicked = false;
    }
    if (!clicked) {
      this.logger.log('No Easy Apply button, trying external application');
      return { kind: 'none' };
    }

    const winner = await Promise.race([
      page
        .waitForFunction(detectEasyApplyRoot, { timeout: 30_000 })
        .then(() => 'form' as const)
        .catch(() => null),
      newTab,
    ]);

    if (winner === 'form') {
      const root = (await page.evaluate(detectEasyApplyRoot)) ?? 'body';
      this.logger.log(`Easy Apply form detected in "${root}" (url: ${page.url()})`);
      await this.human.wait();
      return { kind: 'internal', root };
    }
    if (winner) {
      this.logger.log(`Apply button opened an external tab: ${winner.url()}`);
      return { kind: 'external', page: winner };
    }
    if (!isLinkedInUrl(page.url())) {
      this.logger.log(`Apply button navigated to an external site: ${page.url()}`);
      return { kind: 'external', page };
    }

    // Nada apareció: mostrar qué hay en la página antes de fallar
    await this.aiFormFiller.logInventory(page, 'body');
    throw new Error(`Easy Apply was clicked but no form appeared (url: ${page.url()}).`);
  }

  /** Pestaña nueva abierta desde `page` (o null si no se abre ninguna a tiempo). */
  private waitForNewTab(page: Page, timeoutMs: number): Promise<Page | null> {
    return page
      .browser()
      .waitForTarget((t) => t.opener() === page.target(), { timeout: timeoutMs })
      .then((t) => t.page())
      .catch(() => null);
  }

  /**
   * Aplicación externa: pulsa "Solicitar", toma la pestaña que abre LinkedIn
   * (o la misma página si navega) y recorre el formulario del sitio externo.
   */
  private async applyExternally(page: Page, ctx: AiFormContext): Promise<AiFormOutcome> {
    if (!(await page.evaluate(markExternalApplyButton))) {
      await this.aiFormFiller.logInventory(page, 'body');
      throw new Error('No apply button found (neither Easy Apply nor external).');
    }
    const button = await page.$('[data-af-external]');
    if (!button) throw new Error('External apply button disappeared.');

    const newTab = this.waitForNewTab(page, 15_000);
    await this.human.clickElement(button);
    return this.fillExternal(page, (await newTab) ?? page, ctx);
  }

  /** Recorre el formulario del sitio externo y cierra su pestaña al terminar. */
  private async fillExternal(
    page: Page,
    externalPage: Page,
    ctx: AiFormContext,
  ): Promise<AiFormOutcome> {
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
      resumePath: job.resumePath,
      language: job.language,
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
