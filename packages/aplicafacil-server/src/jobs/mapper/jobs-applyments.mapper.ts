import { JobPostingDto } from '../dto/req/job..osting.dto';
import { JobModel } from '../models/job.model';
import { RequirementsMapper } from './requirements.mapper';
import { SkillMatchMapper } from './skill-match.mapper';

export class JobsApplymentsMapper {
  /**
   * Normaliza la URL de la vacante:
   * - Elimina parámetros de tracking de LinkedIn (eBP, refId, trackingId, trk, ...)
   *   que inflan la URL por encima de 500 caracteres.
   * - Conserva solo el ID de la vacante (view/<id>) para deduplicación.
   * - Si la URL sigue siendo muy larga, la trunca a 2000 caracteres.
   */
  static normalizeUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      // Para LinkedIn, conservar solo el path base + ID
      // Ej: https://www.linkedin.com/jobs/view/4466355053/
      const viewMatch = /\/jobs\/view\/(\d+)/.exec(url.pathname);
      if (viewMatch) {
        return `${url.origin}/jobs/view/${viewMatch[1]}/`;
      }
      // Para otras plataformas, eliminar params de tracking conocidos
      const trackingParams = ['eBP', 'refId', 'trackingId', 'trk', 'utm_source', 'utm_medium', 'utm_campaign'];
      for (const p of trackingParams) {
        url.searchParams.delete(p);
      }
      const normalized = url.toString();
      return normalized.length > 2000 ? normalized.slice(0, 2000) : normalized;
    } catch {
      // Si no es una URL válida, truncar defensivamente
      return rawUrl.length > 2000 ? rawUrl.slice(0, 2000) : rawUrl;
    }
  }

  static fromJobPosting(job: JobPostingDto): JobModel {
    const applyment = new JobModel();
    applyment.title = job.job.title;
    applyment.company = job.company?.name;
    applyment.location = job.location?.rawLocation;
    applyment.description = job.job.description;
    applyment.url = job.source.url ? this.normalizeUrl(job.source.url) : job.source.url;
    applyment.source = job.source.platform;
    applyment.rawContent = job.rawContent;
    applyment.requirements = job.requirements
      ? JSON.stringify(RequirementsMapper.toModel(job.requirements))
      : undefined;
    applyment.matchScore = job.metadata?.skillsMatch
      ? SkillMatchMapper.toModel(job.metadata.skillsMatch).matched
      : undefined;
    return applyment;
  }
}
