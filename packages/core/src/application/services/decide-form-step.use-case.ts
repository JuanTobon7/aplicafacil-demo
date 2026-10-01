import {
  FormAction,
  FormStepDecision,
  FormStepState,
} from '../../domain/job/form-step.js';
import { FORM_STEP_SYSTEM, buildFormStepPrompt } from '../../prompts/form-step.prompt.js';
import { AiCompletionPort } from '../ports/ai-completion.port.js';
import { LoggerPort } from '../ports/logger.port.js';

/**
 * Use case: decidir las acciones de UN paso de un formulario de postulación.
 *
 * El scraper manda la foto del paso (campos vacíos y clickeables con id) y
 * recibe acciones que referencian esos ids: fill / upload / click. El scraper
 * las ejecuta, toma la foto del siguiente paso y vuelve a llamar, hasta que
 * la solicitud quede enviada (loop "until done").
 *
 * Valida la respuesta: descarta acciones con ids que no existen en el paso,
 * de modo que el scraper nunca actúa sobre algo que la IA inventó.
 */
export class DecideFormStepUseCase {
  constructor(
    private readonly ai: AiCompletionPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(state: FormStepState): Promise<FormStepDecision> {
    const raw = await this.ai.complete({
      system: FORM_STEP_SYSTEM,
      prompt: buildFormStepPrompt(state),
    });

    const decision = parseDecision(raw);
    const fieldIds = new Set(state.fields.map((f) => f.name));
    const clickIds = new Set(state.clickables.map((c) => c.id));

    const actions = decision.actions.filter((action) => {
      const known = action.type === 'fill' ? fieldIds.has(action.id) : clickIds.has(action.id);
      if (!known) {
        this.logger.warn(`Acción descartada: ${action.type} sobre id inexistente "${action.id}"`);
      }
      return known;
    });

    return { ...decision, actions };
  }
}

function parseDecision(raw: string): FormStepDecision {
  // Algunos modelos envuelven el JSON en ```json … ``` pese a la instrucción.
  const json = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`La IA no devolvió JSON válido: ${raw.slice(0, 200)}`);
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const actions = (Array.isArray(obj.actions) ? obj.actions : [])
    .map(toAction)
    .filter((a): a is FormAction => a !== null);

  return {
    status: obj.status === 'blocked' ? 'blocked' : 'continue',
    actions,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
  };
}

function toAction(item: unknown): FormAction | null {
  const a = (item ?? {}) as Record<string, unknown>;
  if (typeof a.id !== 'string') return null;

  switch (a.type) {
    case 'fill':
      if (a.value == null) return null;
      return {
        type: 'fill',
        id: a.id,
        value: String(a.value),
        confidence: typeof a.confidence === 'number' ? a.confidence : 0,
        requires_review: a.requires_review === true,
      };
    case 'upload':
    case 'click':
      return { type: a.type, id: a.id };
    default:
      return null;
  }
}
