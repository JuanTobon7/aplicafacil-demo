import { Page } from 'puppeteer';
import { JobPostingDto } from 'src/jobs/dto/req/job..osting.dto';

/**
 * AI_FORM_DRY_RUN: el formulario quedó listo para enviar y se detuvo a
 * propósito. No es un fallo: la vacante debe volver a la cola.
 */
export class DryRunStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DryRunStopError';
  }
}

export abstract class EasyApplyComponent {
  abstract apply(page: Page, job: JobPostingDto): Promise<void>;
}