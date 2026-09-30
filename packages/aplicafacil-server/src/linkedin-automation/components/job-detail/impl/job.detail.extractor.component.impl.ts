import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'puppeteer';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { JobSourceDto } from 'src/jobs/dto/helpers/job.source.dto';
import { JobExtraInfoDto } from 'src/jobs/dto/helpers/job.extrainfo.dto';
import { CompanyDto } from 'src/jobs/dto/helpers/company.dto';
import { LocationDto } from 'src/jobs/dto/helpers/location.dto';
import { JobMetadataDto } from 'src/jobs/dto/helpers/job.metadata.dto';
import { SkillsMatchDto } from 'src/jobs/dto/helpers/skill.match.dto';
import { EmploymentType } from 'src/jobs/enum/employment.yype';
import { WorkplaceType } from 'src/jobs/enum/workplace.type';
import { JobDetailExtractorComponent } from '../contract/job.detail.extractor.component';
import { HumanBehaviorService } from '../../../common/human-behavior.service';

@Injectable()
export class JobDetailExtractorComponentImpl
  implements JobDetailExtractorComponent
{
  private readonly logger = new Logger(JobDetailExtractorComponentImpl.name);

  private readonly SCRAPER_VERSION = '1.0.0';

  constructor(private readonly human: HumanBehaviorService) {}

  async extractJob(page: Page, url: string): Promise<JobPostingDto | null> {
    this.logger.log(`Extracting job: ${url}`);

    try {
      // NOTA: 'domcontentloaded' en lugar de 'networkidle2' (LinkedIn mantiene
      // conexiones persistentes que impiden alcanzar 'idle' en la red).
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });

      // Esperar a que cargue el detalle de la vacante
      await page.waitForSelector(
        '.job-details-jobs-unified-top-card__content--two-pane',
        { timeout: 30_000 },
      );

      // Pausa humana antes de leer el DOM.
      await this.human.wait();

      return this.readJobFromDom(page, url);
    } catch (error) {
      this.logger.error(`Error extracting job ${url}: ${error}`);
      return null;
    }
  }

  /**
   * Lee el detalle de la vacante ya cargada en el panel derecho (two-pane)
   * SIN navegar. Requiere que previamente se haya hecho click en la tarjeta.
   */
  async extractJobFromPanel(
    page: Page,
    url: string,
  ): Promise<JobPostingDto | null> {
    this.logger.debug(`Extracting job from panel: ${url}`);

    try {
      // Esperar a que cargue el detalle de la vacante en el panel derecho.
      // En el nuevo DOM el panel derecho puede tardar en renderizar;
      // esperamos el título de la tarjeta superior o el contenedor genérico.
      await page.waitForFunction(
        () => {
          return (
            document.querySelector(
              '.job-details-jobs-unified-top-card__job-title',
            ) !== null ||
            document.querySelector(
              '.jobs-search__job-details--container',
            ) !== null
          );
        },
        { timeout: 30_000 },
      );

      // Pausa humana antes de leer el DOM del panel.
      await this.human.wait();

      return this.readJobFromDom(page, url);
    } catch (error) {
      this.logger.error(`Error extracting job from panel ${url}: ${error}`);
      return null;
    }
  }

  /**
   * Lee los datos de la vacante desde el DOM actual de la página
   * (ya sea tras navegar o tras hacer click en una tarjeta del panel).
   */
  private async readJobFromDom(
    page: Page,
    url: string,
  ): Promise<JobPostingDto | null> {
    const jobData = await page.evaluate(() => {
        const getText = (selector: string): string => {
          const el = document.querySelector(selector);
          return el?.textContent?.trim() ?? '';
        };

        const title = getText(
          '.job-details-jobs-unified-top-card__job-title',
        );
        const company = getText(
          '.job-details-jobs-unified-top-card__company-name',
        );
        const location = getText(
          '.job-details-jobs-unified-top-card__primary-description-container',
        );
        const description = getText('.jobs-description__content');
        const postedDate = getText(
          '.job-details-jobs-unified-top-card__posted-date',
        );

        // Extraer workplace type y employment type de los badges
        const badges = Array.from(
          document.querySelectorAll(
            '.job-details-jobs-unified-top-card__job-insight',
          ),
        ).map((el) => el.textContent?.trim() ?? '');

        const workplaceType = badges.find((b) =>
          /remote|hybrid|onsite/i.test(b),
        );
        const employmentType = badges.find((b) =>
          /full-time|part-time|contract|temporary|internship|freelance/i.test(
            b,
          ),
        );

        // Extraer seniority level
        const seniority = badges.find((b) =>
          /senior|junior|mid|entry|principal|lead|staff/i.test(b),
        );

        return {
          title,
          company,
          location,
          description,
          postedDate,
          workplaceType,
          employmentType,
          seniority,
        };
      });

      if (!jobData.title) {
        this.logger.warn(`Could not extract job data from ${url}`);
        return null;
      }

      const job = new JobPostingDto();

      // Source
      const source = new JobSourceDto();
      source.platform = 'linkedin';
      source.url = url;
      source.externalId = this.extractExternalId(url);
      source.scraperVersion = this.SCRAPER_VERSION;
      job.source = source;

      // Job extra info
      const jobInfo = new JobExtraInfoDto();
      jobInfo.title = jobData.title;
      jobInfo.description = jobData.description;
      jobInfo.employmentType = this.mapEmploymentType(jobData.employmentType);
      jobInfo.workplaceType = this.mapWorkplaceType(jobData.workplaceType);
      jobInfo.seniorityLevel = jobData.seniority;
      job.job = jobInfo;

      // Company
      const company = new CompanyDto();
      company.name = jobData.company;
      job.company = company;

      // Location
      const location = new LocationDto();
      location.rawLocation = jobData.location;
      job.location = location;

      // Metadata
      const metadata = new JobMetadataDto();
      metadata.title = jobData.title;
      metadata.company = jobData.company;
      metadata.location = jobData.location;
      metadata.postedDate = jobData.postedDate;
      metadata.description = jobData.description;
      metadata.workplaceType = jobData.workplaceType;
      metadata.employmentType = jobData.employmentType;
      metadata.url = url;

      const skillsMatch = new SkillsMatchDto();
      skillsMatch.matched = 0;
      skillsMatch.total = 0;
      metadata.skillsMatch = skillsMatch;

      job.metadata = metadata;
      job.rawContent = jobData.description;
      job.extractedAt = new Date();

      return job;
  }

  /**
   * Extrae el ID externo de la URL de LinkedIn.
   */
  private extractExternalId(url: string): string | undefined {
    const match = /view\/(\d+)/.exec(url);
    return match?.[1];
  }

  /**
   * Mapea el tipo de empleo de texto a enum.
   */
  private mapEmploymentType(value?: string): EmploymentType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v.includes('full')) return EmploymentType.FULL_TIME;
    if (v.includes('part')) return EmploymentType.PART_TIME;
    if (v.includes('contract')) return EmploymentType.CONTRACT;
    if (v.includes('temporary')) return EmploymentType.TEMPORARY;
    if (v.includes('intern')) return EmploymentType.INTERNSHIP;
    if (v.includes('freelance')) return EmploymentType.FREELANCE;
    return undefined;
  }

  /**
   * Mapea el tipo de lugar de trabajo de texto a enum.
   */
  private mapWorkplaceType(value?: string): WorkplaceType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v.includes('remote')) return WorkplaceType.REMOTE;
    if (v.includes('hybrid')) return WorkplaceType.HYBRID;
    if (v.includes('onsite') || v.includes('on-site'))
      return WorkplaceType.ONSITE;
    return undefined;
  }
}