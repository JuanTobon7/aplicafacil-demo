import { Injectable, Logger } from '@nestjs/common';
import { ElementHandle, Page } from 'puppeteer';
import { DecideFormStepUseCase } from '@aplicafacil/core/application';
import { FormAction, FormStepDecision } from '@aplicafacil/core/domain';
import { HumanBehaviorService } from '../../../common/human-behavior.service';
import {
  AiFormContext,
  AiFormFiller,
  AiFormOutcome,
} from '../contract/ai.form.filler';
import { DomClickable, DomField, DomSnapshot, inventoryForm, snapshotForm } from './form.dom';
import { basename } from 'path';
import { FormStepReport, formatInventory, quote } from './form.step.report';

/** Nº de pasos seguidos sin ningún cambio en la página antes de rendirse. */
const MAX_STUCK = 2;
/** Líneas de historial que se le pasan a la IA en cada paso. */
const MAX_HISTORY = 12;

@Injectable()
export class AiFormFillerImpl implements AiFormFiller {
  private readonly logger = new Logger(AiFormFillerImpl.name);
  private readonly maxSteps = readNumberEnv('AI_FORM_MAX_STEPS', 15);
  private readonly minConfidence = readNumberEnv('AI_FORM_MIN_CONFIDENCE', 0.5);
  /** AI_FORM_DRY_RUN=true: llena y avanza, pero se detiene antes de enviar. */
  private readonly dryRun = process.env.AI_FORM_DRY_RUN === 'true';

  constructor(
    private readonly decideStep: DecideFormStepUseCase,
    private readonly human: HumanBehaviorService,
  ) {}

  /**
   * Loop "until done": en cada paso la IA recibe los campos vacíos y los
   * clickeables (con id) y devuelve acciones fill / upload / click sobre esos
   * ids; el scraper las ejecuta, toma la foto del paso siguiente y repite
   * hasta que la solicitud queda enviada, la IA se declara bloqueada o la
   * página deja de cambiar.
   */
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
    const history: string[] = [];
    let snapshot = await this.snapshot(page, rootSelector);
    let stuck = 0;

    while (outcome.steps < this.maxSteps) {
      if (snapshot.success) return { ...outcome, submitted: true };
      if (!snapshot.rootFound) {
        return { ...outcome, reason: 'El formulario se cerró antes de enviarse' };
      }

      outcome.steps++;
      await this.logInventory(page, rootSelector);
      const report = new FormStepReport(outcome.steps, rootSelector, snapshot);

      // 1) La IA decide las acciones del paso (por id)
      let decision: FormStepDecision;
      try {
        decision = await this.decideStep.execute({
          url: ctx.url,
          title: ctx.title,
          metadata: ctx.metadata,
          profileId: ctx.profileId,
          personId: ctx.personId,
          step: outcome.steps,
          heading: snapshot.heading,
          fields: snapshot.fields.map((f) => ({
            name: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
          })),
          filled: snapshot.filled,
          clickables: snapshot.clickables,
          errors: snapshot.errors,
          resumeName: ctx.resumePath ? basename(ctx.resumePath) : undefined,
          history: history.slice(-MAX_HISTORY),
        });
      } catch (error) {
        const reason = `La IA no pudo decidir el paso: ${errorMessage(error)}`;
        this.logger.error(report.result(`✖ ${reason}`));
        return { ...outcome, reason };
      }
      report.aiPlan(decision, snapshot, this.minConfidence);

      if (decision.status === 'blocked') {
        const reason = `La IA no puede continuar: ${decision.reason ?? 'sin motivo'}`;
        this.logger.warn(report.result(`✖ ${reason}`));
        return { ...outcome, reason };
      }

      // 2) El scraper ejecuta las acciones en orden; un click cierra el paso
      const done: string[] = [];
      let clicked: DomClickable | undefined;
      for (const action of decision.actions) {
        if (action.type === 'click') {
          clicked = snapshot.clickables.find((c) => c.id === action.id);
          if (!clicked) continue;
          // Dry-run: recorre todo el formulario pero NUNCA envía la postulación
          if (clicked.kind === 'submit' && this.dryRun) {
            const reason = `DRY RUN: listo para enviar, no se pulsa "${clicked.text}"`;
            this.logger.warn(report.result(`⏸ ${reason}`));
            return { ...outcome, reason };
          }
          if (await this.click(page, clicked, report)) done.push(`click "${clicked.text}"`);
          else clicked = undefined;
          break;
        }
        const summary = await this.runAction(page, action, snapshot, ctx, outcome, report);
        if (summary) done.push(summary);
      }

      // 3) ¿Qué pasó tras las acciones?
      const after = await this.snapshot(page, rootSelector);
      const stepLine = `Paso ${outcome.steps}${snapshot.heading ? ` (${snapshot.heading})` : ''}: ${done.join('; ') || 'sin acciones'}`;

      if (after.success) {
        this.logger.log(report.result('✔ solicitud enviada'));
        return { ...outcome, submitted: true };
      }

      if (clicked?.kind === 'submit') {
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

      if (after.rootFound && progressKey(after) === progressKey(snapshot)) {
        stuck++;
        const errors = after.errors.join('; ') || 'ninguno visible';
        history.push(`${stepLine} → NO avanzó, errores: ${errors}`);
        this.logger.warn(
          report.result(`✖ la página no cambió (${stuck}/${MAX_STUCK}), errores: ${errors}`),
        );
        if (stuck >= MAX_STUCK) {
          return {
            ...outcome,
            reason: `Formulario bloqueado: ${after.errors.join('; ') || 'no avanza y no muestra errores'}`,
          };
        }
      } else {
        stuck = 0;
        const moved = after.fingerprint !== snapshot.fingerprint;
        history.push(`${stepLine} → ${moved ? 'avanzó' : 'mismo paso, cambiaron los campos'}`);
        this.logger.log(
          report.result(moved ? '→ avanzó al siguiente paso' : '→ mismo paso, campos actualizados'),
        );
      }

      snapshot = after;
    }

    return { ...outcome, reason: `Se alcanzó el máximo de ${this.maxSteps} pasos` };
  }

  /** Ejecuta una acción fill / upload. Devuelve su resumen para el historial. */
  private async runAction(
    page: Page,
    action: Exclude<FormAction, { type: 'click' }>,
    snapshot: DomSnapshot,
    ctx: AiFormContext,
    outcome: AiFormOutcome,
    report: FormStepReport,
  ): Promise<string | null> {
    if (action.type === 'upload') {
      const ok = await this.uploadResume(page, action.id, ctx.resumePath, report);
      return ok ? 'subió el CV' : 'FALLÓ subir el CV';
    }

    const field = snapshot.fields.find((f) => f.key === action.id);
    if (!field) return null;
    if (action.confidence < this.minConfidence) {
      addOnce(outcome.skipped, field.label);
      return null;
    }
    if (action.requires_review) addOnce(outcome.pendingReview, field.label);

    try {
      await this.applyValue(page, field, action.value, report);
      return `"${field.label}" = ${quote(action.value)}`;
    } catch (error) {
      report.action('FAIL', field.key, `← ${quote(action.value)}: ${errorMessage(error)}`);
      addOnce(outcome.skipped, field.label);
      return `FALLÓ llenar "${field.label}": ${errorMessage(error)}`;
    }
  }

  private async click(page: Page, target: DomClickable, report: FormStepReport): Promise<boolean> {
    const el = await page.$(`pierce/[data-af-click="${target.id}"]`);
    if (!el) {
      report.action('FAIL', target.id, `botón "${target.text}" no encontrado`);
      return false;
    }
    report.action('click', `botón "${target.text}"`, `(${target.kind})`);
    await this.human.clickElement(el);
    await this.human.wait(1500, 3000);
    return true;
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
   * Sube el CV con el clickeable que eligió la IA: directo si es un
   * input[type=file]; si es un botón ("Cargar currículum"), lo pulsa y
   * responde al selector de archivos del navegador. Devuelve true si se subió.
   */
  private async uploadResume(
    page: Page,
    id: string,
    resumePath: string | undefined,
    report: FormStepReport,
  ): Promise<boolean> {
    if (!resumePath) {
      report.action('FAIL', 'CV', '← el paso pide un CV y el candidato no tiene uno guardado');
      return false;
    }
    const fileName = basename(resumePath);

    try {
      const el = await page.$(`pierce/[data-af-click="${id}"]`);
      if (!el) throw new Error(`clickeable ${id} no encontrado`);
      const isFileInput = await el.evaluate((e) => e.matches('input[type="file"]'));
      if (isFileInput) {
        await (el as ElementHandle<HTMLInputElement>).uploadFile(resumePath);
        report.action('upload', 'input[type=file]', `← ${fileName}`);
      } else {
        const [chooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 10_000 }),
          this.human.clickElement(el),
        ]);
        await chooser.accept([resumePath]);
        report.action('upload', `botón ${id}`, `← ${fileName}`);
      }
      // Dar tiempo a que el sitio procese el archivo
      await this.human.wait(2500, 4000);
      return true;
    } catch (error) {
      report.action('FAIL', 'CV', `← ${fileName}: ${errorMessage(error)}`);
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

function addOnce(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

function readNumberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return process.env[name] && Number.isFinite(parsed) ? parsed : fallback;
}

/** Qué cuenta como "la página cambió": paso, campos vacíos y errores visibles. */
function progressKey(s: DomSnapshot): string {
  return [s.fingerprint, s.fields.map((f) => f.key).join(','), s.errors.join('|')].join('#');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
