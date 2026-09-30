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
import {
  DomField,
  DomSnapshot,
  inventoryForm,
  markAdvanceButton,
  markUploadButton,
  snapshotForm,
} from './form.dom';
import { basename } from 'path';
import { FormStepReport, formatInventory, quote } from './form.step.report';

/** Nº de veces seguidas que avanzar puede no cambiar el paso antes de rendirse. */
const MAX_STUCK = 2;

@Injectable()
export class AiFormFillerImpl implements AiFormFiller {
  private readonly logger = new Logger(AiFormFillerImpl.name);
  private readonly maxSteps = readNumberEnv('AI_FORM_MAX_STEPS', 15);
  private readonly minConfidence = readNumberEnv('AI_FORM_MIN_CONFIDENCE', 0.5);
  /** AI_FORM_DRY_RUN=true: llena y avanza, pero se detiene antes de enviar. */
  private readonly dryRun = process.env.AI_FORM_DRY_RUN === 'true';

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
    let resumeUploaded = false;

    while (outcome.steps < this.maxSteps) {
      if (snapshot.success) return { ...outcome, submitted: true };
      if (!snapshot.rootFound) {
        return { ...outcome, reason: 'El formulario se cerró antes de enviarse' };
      }

      outcome.steps++;
      await this.logInventory(page, rootSelector);
      const report = new FormStepReport(outcome.steps, rootSelector, snapshot);

      // 0) El paso pide un archivo: se sube el CV del candidato (una vez por formulario)
      if (snapshot.wantsFile && !resumeUploaded) {
        resumeUploaded = await this.uploadResume(page, rootSelector, ctx.resumePath, report);
      }

      // 1) La IA decide los valores de los campos vacíos de este paso
      if (snapshot.fields.length > 0) {
        const result = await this.fillForm.execute({
          url: ctx.url,
          title: ctx.title,
          metadata: ctx.metadata,
          profileId: ctx.profileId,
          personId: ctx.personId,
          fields: snapshot.fields.map(toFieldDto),
        });
        report.aiDecisions(snapshot.fields, result.fields, this.minConfidence);
        await this.applyValues(page, snapshot.fields, result.fields, outcome, report);
      }

      // 2) Avanzar (siguiente / revisar / enviar)
      const advance = await page.evaluate(markAdvanceButton, rootSelector);
      const button = advance ? await page.$('pierce/[data-af-advance]') : null;
      if (!advance || !button) {
        const reason = 'No se encontró botón para avanzar o enviar';
        this.logger.warn(report.result(`✖ ${reason}`));
        return { ...outcome, reason };
      }

      // Dry-run: recorre todo el formulario pero NUNCA envía la postulación
      if (advance.kind === 'submit' && this.dryRun) {
        const reason = `DRY RUN: listo para enviar, no se pulsa "${advance.text}"`;
        this.logger.warn(report.result(`⏸ ${reason}`));
        return { ...outcome, reason };
      }

      report.action('click', `botón "${advance.text}"`, `(${advance.kind})`);
      await this.human.clickElement(button);
      await this.human.wait(1500, 3000);

      // 3) ¿Qué pasó tras avanzar?
      const after = await this.snapshot(page, rootSelector);

      if (after.success) {
        this.logger.log(report.result('✔ solicitud enviada'));
        return { ...outcome, submitted: true };
      }

      if (advance.kind === 'submit') {
        // El contenedor del formulario (p.ej. modal de LinkedIn) se cerró al enviar
        if (!after.rootFound) {
          this.logger.log(report.result('✔ enviada (el formulario se cerró)'));
          return { ...outcome, submitted: true };
        }
        // Enviamos un paso con campos y la página cambió sin errores. Si el paso
        // no tenía campos era un "Aplicar" de aterrizaje: se sigue avanzando.
        const changed = after.fingerprint !== snapshot.fingerprint;
        if (snapshot.inputCount > 0 && changed && after.errors.length === 0) {
          this.logger.log(report.result('✔ enviada (la página cambió sin errores)'));
          return { ...outcome, submitted: true };
        }
      }

      if (after.rootFound && after.fingerprint === snapshot.fingerprint) {
        stuck++;
        const errors = after.errors.join('; ') || 'ninguno visible';
        this.logger.warn(
          report.result(`✖ no avanzó (${stuck}/${MAX_STUCK}), errores: ${errors}`),
        );
        if (stuck >= MAX_STUCK) {
          return {
            ...outcome,
            reason: `Formulario bloqueado: ${after.errors.join('; ') || 'no avanza y no muestra errores'}`,
          };
        }
      } else {
        stuck = 0;
        this.logger.log(report.result('→ avanzó al siguiente paso'));
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

  /**
   * Sube el CV: directo al input[type=file] si existe; si no, pulsa el botón
   * "Cargar currículum" y responde al selector de archivos del navegador.
   * Devuelve true si se subió.
   */
  private async uploadResume(
    page: Page,
    rootSelector: string,
    resumePath: string | undefined,
    report: FormStepReport,
  ): Promise<boolean> {
    if (!resumePath) {
      report.action('FAIL', 'CV', '← el paso pide un CV y el candidato no tiene uno guardado');
      return false;
    }
    const fileName = basename(resumePath);

    try {
      const fileInput = (await page.$(
        `pierce/${rootSelector} input[type="file"]`,
      )) as ElementHandle<HTMLInputElement> | null;
      if (fileInput) {
        await fileInput.uploadFile(resumePath);
        report.action('upload', 'input[type=file]', `← ${fileName}`);
      } else {
        const text = await page.evaluate(markUploadButton, rootSelector);
        const button = text ? await page.$('pierce/[data-af-upload]') : null;
        if (!button) return false;
        const [chooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 10_000 }),
          this.human.clickElement(button),
        ]);
        await chooser.accept([resumePath]);
        report.action('upload', `botón "${text}"`, `← ${fileName}`);
      }
      // Dar tiempo a que el sitio procese el archivo
      await this.human.wait(2500, 4000);
      return true;
    } catch (error) {
      report.action('FAIL', 'CV', `← ${fileName}: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  /** Diagnóstico: todos los inputs y clickeables del paso y por qué se analizan o no. */
  async logInventory(page: Page, rootSelector: string): Promise<void> {
    try {
      const inventory = await page.evaluate(inventoryForm, rootSelector);
      this.logger.log(formatInventory(rootSelector, inventory));
    } catch (error) {
      this.logger.warn(
        `inputs and clickeables relevant: no se pudo inventariar (${error instanceof Error ? error.message : error})`,
      );
    }
  }

  private async applyValues(
    page: Page,
    fields: DomField[],
    results: FieldResult[],
    outcome: AiFormOutcome,
    report: FormStepReport,
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
        await this.applyValue(page, field, result.value, report);
      } catch (error) {
        report.action(
          'FAIL',
          field.key,
          `← ${quote(result.value)}: ${error instanceof Error ? error.message : error}`,
        );
        addOnce(outcome.skipped, field.label);
      }
    }
  }

  private async applyValue(
    page: Page,
    field: DomField,
    value: string,
    report: FormStepReport,
  ): Promise<void> {
    // pierce/: el campo puede estar dentro de un shadow DOM
    const selector = `pierce/[data-af-key=${JSON.stringify(field.key)}]`;

    switch (field.type) {
      case 'select':
        await this.human.wait();
        await page.select(selector, value);
        report.action('select', field.key, `← ${quote(value)}`);
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
            report.action('click', `radio ${field.key}`, `→ ${quote(value)}`);
            return;
          }
        }
        throw new Error(`opción "${value}" no encontrada`);
      }

      case 'checkbox': {
        if (value !== 'true') {
          report.action('skip', `checkbox ${field.key}`, '(se deja sin marcar)');
          return;
        }
        const checkbox = await page.$(selector);
        if (checkbox) await this.clickInputOrLabel(checkbox);
        report.action('check', field.key);
        return;
      }

      default: {
        const input = await page.$(selector);
        if (!input) throw new Error('campo no encontrado');
        await this.human.wait();
        await input.click();
        await input.type(value, { delay: await this.human.typeDelay() });
        report.action('type', field.key, `← ${quote(value)}`);

        // Typeaheads (p.ej. ciudad en LinkedIn): elegir la primera sugerencia
        const isCombobox = await input.evaluate(
          (el) => el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete'),
        );
        if (isCombobox) {
          await this.human.wait(1000, 1800);
          await input.press('ArrowDown');
          await input.press('Enter');
          report.action('pick', field.key, '(primera sugerencia del autocompletado)');
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
