import { Inject, Injectable, Logger } from '@nestjs/common';
import { Browser, Page } from 'puppeteer';
import { ScrapingLinkldnService } from '../../contract/scraping.linkldn.service';
import { LinkedInSearchParams } from '../../../dto/params.lindkln.search';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import {
  BrowserManager,
  BrowserTab,
} from '../../../components/browser-manager/contract/browser.manager';
import { LinkedInLoginComponent } from '../../../components/login/contract/linkedin.login.component';
import { JobSearchComponent } from '../../../components/job-search/contract/job.search.component';
import { JobDetailExtractorComponent } from '../../../components/job-detail/contract/job.detail.extractor.component';
import { EasyApplyComponent } from '../../../components/easy-apply/contract/easy.apply.component';
import { CaptchaDetector } from '../../../components/captcha/contract/captcha.detector';

@Injectable()
export class ScrapingLinkldnServiceImpl implements ScrapingLinkldnService {
  private readonly logger = new Logger(ScrapingLinkldnServiceImpl.name);
  /**
   * Navegador en el que ya se inició sesión. Las cookies se comparten entre
   * pestañas, así que basta un login por instancia de navegador; si el
   * BrowserManager lanza uno nuevo, se vuelve a iniciar sesión.
   */
  private loggedInBrowser: Browser | null = null;
  /** Login en curso (evita dos logins simultáneos desde el worker y el cron). */
  private loginInFlight: Promise<void> | null = null;

  constructor(
    @Inject(BrowserManager)
    private readonly browserManager: BrowserManager,
    @Inject(LinkedInLoginComponent)
    private readonly loginComponent: LinkedInLoginComponent,
    @Inject(JobSearchComponent)
    private readonly jobSearchComponent: JobSearchComponent,
    @Inject(JobDetailExtractorComponent)
    private readonly jobDetailExtractor: JobDetailExtractorComponent,
    @Inject(EasyApplyComponent)
    private readonly easyApplyComponent: EasyApplyComponent,
    @Inject(CaptchaDetector)
    private readonly captchaDetector: CaptchaDetector,
  ) {}

  /**
   * Abre la pestaña del consumidor y garantiza la sesión de LinkedIn.
   *
   * Idempotente: si el navegador ya tiene sesión, solo asegura la pestaña.
   * Si el BrowserManager relanzó el navegador, inicia sesión de nuevo (las
   * cookies guardadas por el SessionStore suelen evitar el login completo).
   */
  async openLinkdlnProfile(
    credentials: { email: string; password: string },
    tab: BrowserTab = 'apply',
  ): Promise<void> {
    const page = await this.browserManager.getPage(tab);

    if (page.browser() === this.loggedInBrowser) {
      this.logger.debug(`LinkedIn session already open. Reusing it for tab "${tab}".`);
      return;
    }

    this.loginInFlight ??= this.login(page, credentials).finally(() => {
      this.loginInFlight = null;
    });
    await this.loginInFlight;
  }

  private async login(
    page: Page,
    credentials: { email: string; password: string },
  ): Promise<void> {
    this.logger.log('Opening LinkedIn profile...');
    await this.loginComponent.login(page, credentials);

    // Tras el login, comprobamos que LinkedIn no haya interpuesto un
    // CAPTCHA (el guard del BrowserManager ya lo pausó esperando a que
    // un humano lo resuelva en el navegador visible).
    await this.assertNoCaptcha(page);

    this.loggedInBrowser = page.browser();
    this.logger.log('LinkedIn profile opened successfully.');
  }

  async releaseTab(tab: BrowserTab): Promise<void> {
    await this.browserManager.releasePage(tab);
  }

  /**
   * Lanza `CaptchaDetectedError` si la página actual es un challenge de
   * seguridad de LinkedIn (CAPTCHA). Se delega en el CaptchaDetector.
   */
  async assertNoCaptcha(page: Page): Promise<void> {
    await this.captchaDetector.assertNoCaptcha(page);
  }

  /**
   * Espera (con timeout) a que un humano resuelva el CAPTCHA en el
   * navegador visible. Se delega en el CaptchaDetector.
   */
  async waitForCaptchaResolution(
    page: Page,
    timeoutMs?: number,
  ): Promise<boolean> {
    return this.captchaDetector.waitForCaptchaResolution(page, timeoutMs);
  }

  /**
   * Obtiene la lista de vacantes a postularse navegando a la página de
   * búsqueda de empleos, aplicando los filtros y extrayendo las vacantes.
   *
   * SIEMPRE usa una pestaña separada (searchPage) para no interferir con
   * la página principal que usa la cola para postular. Así el cron de
   * búsqueda nunca pisa una postulación en curso.
   *
   * El flujo navega ENTRE las tarjetas de la lista (click en cada una para
   * cargar el detalle en el panel derecho) en lugar de hacer page.goto()
   * por cada vacante, que es más lento y propenso a bloqueos.
   */
  async getJobsToApply(params: LinkedInSearchParams): Promise<JobPostingDto[]> {
    this.logger.log('Getting jobs to apply...');

    const page = await this.requireSessionPage('search');

    // Si LinkedIn interpuso un CAPTCHA en la pestaña de búsqueda, abortamos
    // de forma controlada (el guard del BrowserManager ya lo pausó esperando
    // a que un humano lo resuelva en el navegador visible).
    await this.assertNoCaptcha(page);

    const jobLinks = await this.jobSearchComponent.searchJobs(page, params);

    const jobs: JobPostingDto[] = [];
    for (const link of jobLinks) {
      const jobId = this.extractJobId(link);
      if (!jobId) {
        this.logger.warn(`Could not extract jobId from ${link}`);
        continue;
      }

      try {
        // Navegar a la tarjeta: click para cargar el detalle en el panel derecho
        await this.jobSearchComponent.clickJobCard(page, jobId);

        // Leer el detalle del panel derecho (sin navegar)
        const job = await this.jobDetailExtractor.extractJobFromPanel(
          page,
          link,
        );
        if (job) {
          jobs.push(job);
        }
      } catch (error) {
        this.logger.warn(`Could not process job ${link}: ${error}`);
      }
    }

    return jobs;
  }

  /**
   * Extrae el jobId numérico de una URL de vacante de LinkedIn.
   */
  private extractJobId(url: string): string | null {
    const match = /\/jobs\/view\/(\d+)/.exec(url);
    return match?.[1] ?? null;
  }

  /**
   * Busca una vacante específica por URL y extrae toda su información.
   */
  async searchJob(url: string): Promise<JobPostingDto | null> {
    this.logger.log(`Searching job: ${url}`);

    const page = await this.requireSessionPage('apply');

    // Si LinkedIn interpuso un CAPTCHA, abortamos de forma controlada.
    await this.assertNoCaptcha(page);

    return this.jobDetailExtractor.extractJob(page, url);
  }

  /**
   * Resuelve el formulario de postulación y aplica a la vacante.
   * Marca la página principal como "en uso" para que el cron de búsqueda
   * abra una pestaña separada y no pise la postulación en curso.
   */
  async resolveFillFormAndApply(job: JobPostingDto): Promise<void> {
    const page = await this.requireSessionPage('apply');

    // Si LinkedIn interpuso un CAPTCHA al abrir la vacante, abortamos de
    // forma controlada (el guard del BrowserManager ya lo pausó esperando
    // a que un humano lo resuelva en el navegador visible).
    await this.assertNoCaptcha(page);

    await this.easyApplyComponent.apply(page, job);
  }

  /**
   * Cierra el navegador y todas sus pestañas.
   */
  async close(): Promise<void> {
    await this.browserManager.closeAll();
    this.loggedInBrowser = null;
  }

  /**
   * Retorna la pestaña del consumidor, exigiendo una sesión de LinkedIn
   * activa (lanza error si hay que llamar antes a openLinkdlnProfile).
   */
  private async requireSessionPage(tab: BrowserTab): Promise<Page> {
    if (!this.loggedInBrowser?.connected) {
      throw new Error(
        `LinkedIn session is not open. Call openLinkdlnProfile(credentials, '${tab}') first.`,
      );
    }
    const page = await this.browserManager.getPage(tab);
    if (page.browser() !== this.loggedInBrowser) {
      throw new Error('Browser was relaunched. Call openLinkdlnProfile again.');
    }
    return page;
  }
}