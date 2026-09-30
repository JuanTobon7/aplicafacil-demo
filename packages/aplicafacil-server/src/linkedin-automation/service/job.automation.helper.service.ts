import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfileModel } from 'src/profiles/models/profiles.model';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';
import { JobSourceDto } from 'src/jobs/dto/helpers/job.source.dto';
import { JobExtraInfoDto } from 'src/jobs/dto/helpers/job.extrainfo.dto';
import { CompanyDto } from 'src/jobs/dto/helpers/company.dto';
import { LocationDto } from 'src/jobs/dto/helpers/location.dto';
import { JobMetadataDto } from 'src/jobs/dto/helpers/job.metadata.dto';
import { JobModel } from 'src/jobs/models/job.model';
import { PeopleService } from 'src/people/service/contract/people.service';

/**
 * Helpers del worker de automatización de empleos.
 *
 * Agrupa los métodos utilitarios que no forman parte del contrato
 * público del worker (crons / ciclo de vida), para mantener el worker
 * enfocado en la orquestación.
 */
@Injectable()
export class JobAutomationHelperService {
  private readonly logger = new Logger(JobAutomationHelperService.name);

  constructor(
    private readonly peopleService: PeopleService,
    @InjectRepository(ProfileModel)
    private readonly profileRepository: Repository<ProfileModel>,
  ) {}

  /**
   * Ruta local del CV del candidato: el del perfil de la vacante o, si no
   * tiene, el del primer perfil de la persona con CV guardado.
   * Con storage S3 el archivo se descarga a un temporal.
   */
  async resolveResumePath(job: JobModel): Promise<string | undefined> {
    const where = [
      ...(job.profileId ? [{ id: job.profileId }] : []),
      ...(job.personId ? [{ people: { id: job.personId } }] : []),
    ];
    if (where.length === 0) return undefined;

    const profiles = await this.profileRepository.find({ where, relations: { cv: true } });
    const ordered = [
      ...profiles.filter((p) => p.id === job.profileId),
      ...profiles.filter((p) => p.id !== job.profileId),
    ];
    const cv = ordered.find((p) => p.cv?.filePath)?.cv;
    if (!cv) {
      this.logger.warn(`No CV stored for job "${job.title}" (profile/person has no cv)`);
      return undefined;
    }

    const fileName = path.basename(new URL(cv.filePath).pathname);
    if ((process.env.STORAGE_MODE ?? 'local') === 'local') {
      return path.resolve(process.env.LOCAL_STORAGE_PATH ?? 'uploads', 'cv', fileName);
    }

    const response = await fetch(cv.filePath);
    if (!response.ok) throw new Error(`Could not download CV (${response.status})`);
    const tmpPath = path.join(os.tmpdir(), `aplicafacil-${fileName}`);
    await fs.promises.writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
    return tmpPath;
  }

  /**
   * Convierte un JobModel (de la BD) en un JobPostingDto para el scraper.
   */
  toJobPosting(job: JobModel): JobPostingDto {
    const dto = new JobPostingDto();

    const source = new JobSourceDto();
    source.platform = job.source ?? 'linkedin';
    source.url = job.url ?? '';
    source.externalId = this.extractJobIdFromUrl(job.url ?? '');
    dto.source = source;

    const jobInfo = new JobExtraInfoDto();
    jobInfo.title = job.title;
    jobInfo.description = job.description;
    dto.job = jobInfo;

    const company = new CompanyDto();
    company.name = job.company;
    dto.company = company;

    const location = new LocationDto();
    location.rawLocation = job.location;
    dto.location = location;

    const metadata = new JobMetadataDto();
    metadata.title = job.title;
    metadata.company = job.company ?? '';
    metadata.location = job.location ?? '';
    metadata.description = job.description ?? '';
    metadata.url = job.url ?? '';
    dto.metadata = metadata;

    dto.rawContent = job.rawContent;
    dto.extractedAt = new Date();
    dto.profileId = job.profileId;
    dto.personId = job.personId;

    return dto;
  }

  /**
   * Extrae el jobId numérico de una URL de vacante de LinkedIn.
   */
  extractJobIdFromUrl(url: string): string {
    const match = /\/jobs\/view\/(\d+)/.exec(url);
    return match?.[1] ?? url;
  }

  /**
   * Obtiene el userId (personId) de la primera persona registrada,
   * que es el usuario dueño de la automatización.
   */
  async getAutomationUserId(): Promise<string> {
    const people = await this.peopleService.findAll();
    if (people.length === 0) {
      throw new Error(
        'No people registered. Cannot run job automation without a user.',
      );
    }
    return people[0].id;
  }

  /**
   * Lee las credenciales de LinkedIn desde las variables de entorno.
   */
  getCredentialsLinkdln(): { email: string; password: string } {
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'LinkedIn credentials are not set in environment variables.',
      );
    }

    return { email, password };
  }

  /**
   * Limita la cantidad de vacantes a procesar por ciclo.
   */
  extractNumberOfJobsToApply<T>(
    jobs: T[],
    maxJobs: number,
  ): T[] {
    if (jobs.length > maxJobs) {
      return jobs.slice(0, maxJobs);
    }
    return jobs;
  }
}