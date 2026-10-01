import { FieldDto } from './field.dto.js';
import { JobMetadataDto } from './job.metadata.dto.js';

/** Tipo de un clickeable según su texto (lo calcula el scraper). */
export type ClickableKind = 'submit' | 'review' | 'next' | 'upload' | 'other';

/** Botón, link o input de archivo del paso actual, identificado por `id`. */
export interface FormStepClickable {
  id: string;
  text: string;
  kind: ClickableKind;
}

/**
 * Foto de UN paso del formulario tal como la ve el scraper. La IA responde
 * con acciones que referencian los `id` de estos campos y clickeables.
 */
export interface FormStepState {
  url: string;
  title: string;
  metadata: JobMetadataDto;
  profileId?: string;
  personId?: string;
  /** Nº de paso dentro del formulario (1, 2, …). */
  step: number;
  heading: string;
  /** Campos VACÍOS del paso: `name` es el id que debe usar la acción fill. */
  fields: FieldDto[];
  /** Campos ya llenos (contexto, no se tocan). */
  filled: Array<{ label: string; value: string }>;
  clickables: FormStepClickable[];
  /** Mensajes de validación visibles. */
  errors: string[];
  /** Nombre del CV disponible para subir, o undefined si no hay. */
  resumeName?: string;
  /** Lo hecho en pasos anteriores de este formulario (y si avanzó o no). */
  history: string[];
}

export type FormAction =
  | { type: 'fill'; id: string; value: string; confidence: number; requires_review: boolean }
  | { type: 'upload'; id: string }
  | { type: 'click'; id: string };

export interface FormStepDecision {
  /** continue: ejecutar `actions`; blocked: no se puede seguir (ver `reason`). */
  status: 'continue' | 'blocked';
  actions: FormAction[];
  reason?: string;
}
