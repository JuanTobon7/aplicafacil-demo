import { Page } from 'puppeteer';
import { JobMetadataDto } from '@aplicafacil/core/domain';

/** Contexto de la vacante y del candidato para el que se llena el formulario. */
export interface AiFormContext {
  url: string;
  title: string;
  metadata: JobMetadataDto;
  /** El LLM consulta el perfil vía la tool MCP get_candidate_profile. */
  profileId?: string;
  /** El LLM consulta los datos personales vía get_candidate_person. */
  personId?: string;
  /** Ruta local del CV del candidato, para los pasos que piden subirlo. */
  resumePath?: string;
}

export interface AiFormOutcome {
  submitted: boolean;
  /** Pasos del formulario recorridos. */
  steps: number;
  /** Motivo por el que se detuvo sin enviar. */
  reason?: string;
  /** Campos que la IA llenó marcándolos para revisión humana. */
  pendingReview: string[];
  /** Campos que la IA no se atrevió a llenar (sin valor o baja confianza). */
  skipped: string[];
}

export abstract class AiFormFiller {
  /**
   * Recorre un formulario de postulación paso a paso hasta enviarlo:
   * detecta campos vacíos → la IA decide los valores → avanza → repite.
   *
   * @param rootSelector contenedor del formulario ('.jobs-easy-apply-modal'
   *                     en LinkedIn, 'body' en sitios externos).
   */
  abstract fillUntilDone(
    page: Page,
    rootSelector: string,
    ctx: AiFormContext,
  ): Promise<AiFormOutcome>;

  /** Loguea los inputs y clickeables del contenedor (diagnóstico). */
  abstract logInventory(page: Page, rootSelector: string): Promise<void>;
}
