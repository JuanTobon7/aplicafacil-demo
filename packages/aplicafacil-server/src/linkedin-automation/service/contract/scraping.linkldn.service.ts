import { Page } from 'puppeteer';
import { BrowserTab } from "src/linkedin-automation/components/browser-manager/contract/browser.manager";
import { JobPostingDto } from "src/jobs/dto/req/job..osting.dto";
import { LinkedInSearchParams } from "src/linkedin-automation/dto/params.lindkln.search";

export abstract class ScrapingLinkldnService {
    /**
     * Abre la pestaña `tab` del navegador compartido con sesión de LinkedIn.
     * Si el navegador no existe (o se cerró), el BrowserManager lo relanza.
     */
    abstract openLinkdlnProfile(
        credentials: {email: string, password: string},
        tab?: BrowserTab,
    ): Promise<void>;

    /**
     * Cierra la pestaña del consumidor al terminar su trabajo.
     * Si era la última pestaña abierta, se cierra el navegador.
     */
    abstract releaseTab(tab: BrowserTab): Promise<void>;

    /**
     * Get the list of job postings to apply for from
     * the linkdln scraping service.
     * navigate to the jobs list page, apply the filters and extract the job postings.
     */
    abstract getJobsToApply(params: LinkedInSearchParams): Promise<JobPostingDto[]>;

    abstract searchJob(url: string): Promise<JobPostingDto | null>;
    abstract resolveFillFormAndApply(job: JobPostingDto): Promise<void>;

    /**
     * Lanza `CaptchaDetectedError` si la página actual es un challenge de
     * seguridad de LinkedIn (CAPTCHA). Se debe llamar después de cada
     * navegación para abortar el flujo de forma controlada.
     */
    abstract assertNoCaptcha(page: Page): Promise<void>;

    /**
     * Espera (con timeout) a que un humano resuelva el CAPTCHA en el
     * navegador visible. Devuelve true si se resolvió, false si se agotó
     * el tiempo. NO lanza errores.
     */
    abstract waitForCaptchaResolution(
        page: Page,
        timeoutMs?: number,
    ): Promise<boolean>;

    /**
     * Cierra el navegador Puppeteer.
     */
    abstract close(): Promise<void>;

}