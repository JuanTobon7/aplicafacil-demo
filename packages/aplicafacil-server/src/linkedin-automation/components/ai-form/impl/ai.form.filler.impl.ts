import { Injectable, Logger } from '@nestjs/common';
import { ElementHandle, Page } from 'puppeteer';
import { FillFormUseCase } from '@aplicafacil/core/application';
import { FieldDto, FieldResult } from '@aplicafacil/core/domain';
import { HumanBehaviorService } from '../../../common/human-behavior.service';
import {
  AiFormContext,
  AiFormFiller,
  AiFormOutcome,
} from '../contract/ai.form.filler';
import { DomField, DomSnapshot, markAdvanceButton, snapshotForm } from './form.dom';

/** Nº de veces seguidas que avanzar puede no cambiar el paso antes de rendirse. */
const MAX_STUCK = 2;

@Injectable()
export class AiFormFillerImpl implements AiFormFiller {
  private readonly logger = new Logger(AiFormFillerImpl.name);
  private readonly maxSteps = readNumberEnv('AI_FORM_MAX_STEPS', 15);
  private readonly minConfidence = readNumberEnv('AI_FORM_MIN_CONFIDENCE', 0.5);

  constructor(
    private readonly fillForm: FillFormUseCase,
    private readonly human: HumanBehaviorService,
  ) {}

  async fillUntilDone(
    page: Page,
    rootSelector: string,
    ctx: AiFormContext,
  ): Promise<AiFormOutcome> {
    const outcome: AiFormOutcome = {
      submitted: false,
      steps: 0,
      pendingReview: [],
      skipped: [],
    };
    let snapshot = await this.snapshot(page, rootSelector);
    let stuck = 0;

    while (outcome.steps < this.maxSteps) {
      if (snapshot.success) return { ...outcome, submitted: true };
      if (!snapshot.rootFound) {
        return { ...outcome, reason: 'El formulario se cerró antes de enviarse' };
      }

      outcome.steps++;

      // 1) La IA decide los valores de los campos vacíos de este paso
      if (snapshot.fields.length > 0) {
        this.logger.log(
          `Paso ${outcome.steps}: ${snapshot.fields.length} campos vacíos → IA`,
        );
        const result = await this.fillForm.execute({
          url: ctx.url,
          title: ctx.title,
          metadata: ctx.metadata,
          profileId: ctx.profileId,
          personId: ctx.personId,
          fields: snapshot.fields.map(toFieldDto),
        });
        await this.applyValues(page, snapshot.fields, result.fields, outcome);
      }

      // 2) Avanzar (siguiente / revisar / enviar)
      const advance = await page.evaluate(markAdvanceButton, rootSelector);
      if (!advance) {
        return { ...outcome, reason: 'No se encontró botón para avanzar o enviar' };
      }
      const button = await page.$('[data-af-advance]');
      if (!button) {
        return { ...outcome, reason: 'El botón para avanzar desapareció' };
      }

      this.logger.log(`Paso ${outcome.steps}: pulsando "${advance.text}" (${advance.kind})`);
      await this.human.clickElement(button);
      await this.human.wait(1500, 3000);

      // 3) ¿Qué pasó tras avanzar?
      const after = await this.snapshot(page, rootSelector);

      if (after.success) return { ...outcome, submitted: true };

      if (advance.kind === 'submit') {
        // El contenedor del formulario (p.ej. modal de LinkedIn) se cerró al enviar
        if (!after.rootFound) return { ...outcome, submitted: true };
        // Enviamos un paso con campos y la página cambió sin errores. Si el paso
        // no tenía campos era un "Aplicar" de aterrizaje: se sigue avanzando.
        const changed = after.fingerprint !== snapshot.fingerprint;
        if (snapshot.inputCount > 0 && changed && after.errors.length === 0) {
          return { ...outcome, submitted: true };
        }
      }

      if (after.rootFound && after.fingerprint === snapshot.fingerprint) {
        stuck++;
        this.logger.warn(
          `El paso no avanzó (${stuck}/${MAX_STUCK}). Errores: ${after.errors.join('; ') || 'ninguno visible'}`,
        );
        if (stuck >= MAX_STUCK) {
          return {
            ...outcome,
            reason: `Formulario bloqueado: ${after.errors.join('; ') || 'no avanza y no muestra errores'}`,
          };
        }
      } else {
        stuck = 0;
      }

      snapshot = after;
    }

    return { ...outcome, reason: `Se alcanzó el máximo de ${this.maxSteps} pasos` };
  }

  /**
   * Toma la foto del formulario. Reintenta si la página está navegando
   * (el contexto de ejecución se destruye durante la navegación).
   */
  private async snapshot(page: Page, rootSelector: string): Promise<DomSnapshot> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await page.evaluate(snapshotForm, rootSelector);
      } catch (error) {
        if (attempt >= 5) throw error;
        await this.human.wait(1000, 1500);
      }
    }
  }

  private async applyValues(
    page: Page,
    fields: DomField[],
    results: FieldResult[],
    outcome: AiFormOutcome,
  ): Promise<void> {
    const byKey = new Map(fields.map((f) => [f.key, f]));

    for (const result of results) {
      const field = byKey.get(result.fieldName);
      if (!field) continue;

      if (result.value == null || result.confidence < this.minConfidence) {
        addOnce(outcome.skipped, field.label);
        continue;
      }
      if (result.requires_review) addOnce(outcome.pendingReview, field.label);

      try {
        await this.applyValue(page, field, result.value);
      } catch (error) {
        this.logger.warn(
          `No se pudo llenar "${field.label}": ${error instanceof Error ? error.message : error}`,
        );
        addOnce(outcome.skipped, field.label);
      }
    }
  }

  private async applyValue(page: Page, field: DomField, value: string): Promise<void> {
    const selector = `[data-af-key=${JSON.stringify(field.key)}]`;

    switch (field.type) {
      case 'select':
        await this.human.wait();
        await page.select(selector, value);
        return;

      case 'radio': {
        const radios = await page.$$(selector);
        for (const radio of radios) {
          const matches = await radio.evaluate(
            (el, v) => {
              const input = el as HTMLInputElement;
              const label = (input.labels?.[0]?.innerText ?? '').replace(/\s+/g, ' ').trim();
              return input.value === v || label === v;
            },
            value,
          );
          if (matches) {
            await this.clickInputOrLabel(radio);
            return;
          }
        }
        throw new Error(`opción "${value}" no encontrada`);
      }

      case 'checkbox': {
        if (value !== 'true') return;
        const checkbox = await page.$(selector);
        if (checkbox) await this.clickInputOrLabel(checkbox);
        return;
      }

      default: {
        const input = await page.$(selector);
        if (!input) throw new Error('campo no encontrado');
        await this.human.wait();
        await input.click();
        await input.type(value, { delay: await this.human.typeDelay() });

        // Typeaheads (p.ej. ciudad en LinkedIn): elegir la primera sugerencia
        const isCombobox = await input.evaluate(
          (el) => el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete'),
        );
        if (isCombobox) {
          await this.human.wait(1000, 1800);
          await input.press('ArrowDown');
          await input.press('Enter');
        }
        await this.human.wait();
      }
    }
  }

  /** Los radios/checkbox suelen estar ocultos tras su <label>: se pulsa el label. */
  private async clickInputOrLabel(input: ElementHandle<Element>): Promise<void> {
    const label = await input.evaluateHandle(
      (el) => (el as HTMLInputElement).labels?.[0] ?? el,
    );
    await this.human.clickElement(label as ElementHandle<Element>);
  }
}

function toFieldDto(field: DomField): FieldDto {
  return {
    name: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    options: field.options,
  };
}

function addOnce(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

function readNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] && Number.isFinite(parsed) ? parsed : fallback;
}
