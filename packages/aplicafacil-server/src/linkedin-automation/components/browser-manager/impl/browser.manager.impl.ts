import { Inject, Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { BrowserManager, BrowserTab } from '../contract/browser.manager';
import { CaptchaDetector } from '../../captcha/contract/captcha.detector';

/**
 * Tipos de recursos pesados que bloqueamos para reducir el consumo de red
 * y acelerar la carga de las páginas de LinkedIn.
 *
 * LinkedIn carga muchas imágenes (avatares, logos, banners), fuentes y media
 * que no necesitamos para scraping. Bloquearlos ahorra ancho de banda y CPU.
 */
const BLOCKED_RESOURCE_TYPES = new Set([
  'image',
  'media',
  'font',
  'texttrack',
  'eventsource',
  'manifest',
]);

/**
 * Instancia de Puppeteer "extra" con el plugin stealth.
 *
 * `puppeteer-extra` envuelve la instancia local de Puppeteer (v25) y le
 * añade el plugin stealth, que parchea las huellas de automatización que
 * los anti-bots (incluido el challenge de LinkedIn) detectan:
 *
 * - `navigator.webdriver` → false
 * - plugins y lenguajes del navegador
 * - WebGL, Chrome runtime, permisos, etc.
 *
 * NOTA: con Puppeteer v25 NO se usa `require('puppeteer-extra').default`
 * con el puppeteer global; se pasa la instancia local con `addExtra()`.
 */
const puppeteerExtra = addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

@Injectable()
export class BrowserManagerImpl implements BrowserManager {
  private readonly logger = new Logger(BrowserManagerImpl.name);

  /**
   * Páginas en las que el bloqueo de recursos está desactivado.
   *
   * Cuando LinkedIn interpone un CAPTCHA necesitamos que carguen las
   * imágenes y demás recursos para que el humano pueda ver y resolver
   * la verificación. Mientras la página esté en este conjunto, no se
   * aborta ningún recurso.
   */
  private readonly resourceBlockingDisabled = new WeakSet<Page>();

  /** Navegador activo (null si no hay ninguno lanzado). */
  private browser: Browser | null = null;
  /** Pestaña de cada consumidor. */
  private readonly tabs = new Map<BrowserTab, Page>();
  /**
   * Serializa lanzar/cerrar: evita que el worker y el cron lancen dos
   * navegadores a la vez, o que uno cierre el navegador mientras el otro
   * está abriendo su pestaña.
   */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(CaptchaDetector)
    private readonly captchaDetector: CaptchaDetector,
  ) {}

  /**
   * Indica si una URL pertenece al challenge de seguridad de LinkedIn.
   */
  private isCaptchaUrl(url: string): boolean {
    return url.includes('/checkpoint/challenge/');
  }

  getPage(tab: BrowserTab): Promise<Page> {
    return this.exclusive(async () => {
      const existing = this.tabs.get(tab);
      if (existing && !existing.isClosed()) return existing;
      this.tabs.delete(tab);

      const browser = await this.ensureBrowser();

      // Reutiliza la pestaña en blanco con la que arranca Chrome (si nadie
      // la usa) para no dejar una pestaña vacía colgando.
      const owned = new Set(this.tabs.values());
      const blank = (await browser.pages()).find(
        (p) => p.url() === 'about:blank' && !owned.has(p),
      );
      const page = blank ?? (await browser.newPage());
      await this.setupPage(page);

      // Si alguien cierra la pestaña a mano, se olvida y se recrea al pedirla.
      page.once('close', () => {
        if (this.tabs.get(tab) === page) this.tabs.delete(tab);
      });

      this.tabs.set(tab, page);
      this.logger.debug(
        `Tab "${tab}" opened (open tabs: ${[...this.tabs.keys()].join(', ')})`,
      );
      return page;
    });
  }

  releasePage(tab: BrowserTab): Promise<void> {
    return this.exclusive(async () => {
      const page = this.tabs.get(tab);
      this.tabs.delete(tab);
      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
        this.logger.debug(`Tab "${tab}" closed`);
      }

      if (this.tabs.size === 0) {
        await this.closeBrowser();
      }
    });
  }

  closeAll(): Promise<void> {
    return this.exclusive(() => this.closeBrowser());
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    this.logger.log('Launching browser...');
    const browser = await puppeteerExtra.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 800 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // Si el navegador muere o se cierra a mano, se relanza en el próximo getPage.
    browser.once('disconnected', () => {
      if (this.browser === browser) {
        this.logger.warn('Browser disconnected');
        this.browser = null;
        this.tabs.clear();
      }
    });

    this.browser = browser;
    this.tabs.clear();
    return browser;
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.tabs.clear();
    if (browser?.connected) {
      this.logger.log('No tabs left, closing browser...');
      await browser.close().catch(() => undefined);
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Configura una pestaña: user agent, bloqueo de recursos y guard de CAPTCHA. */
  private async setupPage(page: Page): Promise<void> {

    // NOTA: NO reenviamos los console.* de la página del navegador a Node.
    // LinkedIn loguea muchísimo ruido interno (tracking, telemetría, warnings
    // de proto attributes...) que inundaría la terminal. Los logs que nos
    // interesan (clicker, form filler, etc.) se emiten desde Node con el
    // Logger de NestJS, no desde dentro del navegador.

    // Set a realistic user agent to avoid bot detection
    await page
      .setUserAgent({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        platform: 'Windows',
      })
      .catch(() => undefined);

    // Bloquear recursos pesados (imágenes, fuentes, media, trackers) para
    // reducir el consumo de red. Se hace ANTES de cualquier navegación.
    //
    // EXCEPCIÓN: si la página está en un CAPTCHA (o navegando hacia uno),
    // dejamos pasar TODOS los recursos para que el humano pueda ver y
    // resolver la verificación (imágenes del reCAPTCHA, fuentes, etc.).
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const captchaActive =
        this.resourceBlockingDisabled.has(page) ||
        this.isCaptchaUrl(page.url()) ||
        this.isCaptchaUrl(request.url());

      if (
        !captchaActive &&
        BLOCKED_RESOURCE_TYPES.has(request.resourceType())
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Guard de seguridad: cada página nueva queda protegida contra el
    // challenge de seguridad de LinkedIn (CAPTCHA). Si LinkedIn redirige
    // a /checkpoint/challenge/, se loguea y se pausa el flujo esperando
    // a que un humano lo resuelva en el navegador visible.
    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) {
        return;
      }
      try {
        const detection = await this.captchaDetector.detect(page);
        if (detection.detected) {
          this.logger.warn(
            `[CaptchaGuard] LinkedIn CAPTCHA detected at ${detection.url}` +
              (detection.title ? ` — "${detection.title}"` : ''),
          );
          // Permitir que carguen imágenes y demás recursos para que el
          // humano pueda ver y resolver el CAPTCHA en el navegador visible.
          this.resourceBlockingDisabled.add(page);
          // Pausa el flujo hasta que el usuario resuelva el CAPTCHA
          // (el navegador es visible: headless: false).
          await this.captchaDetector.waitForCaptchaResolution(page);
          // Restaurar el bloqueo de recursos tras resolver el CAPTCHA.
          this.resourceBlockingDisabled.delete(page);
        }
      } catch (error) {
        this.logger.warn(
          `[CaptchaGuard] Error checking CAPTCHA: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    });

  }
}