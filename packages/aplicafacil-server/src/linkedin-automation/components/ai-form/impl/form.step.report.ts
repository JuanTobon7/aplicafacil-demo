import { FieldResult } from '@aplicafacil/core/domain';
import { DomField, DomInventory, DomSnapshot } from './form.dom';

const MAX_VALUE_LENGTH = 60;

/**
 * Reporte de UN paso del formulario, emitido como un solo bloque de log:
 *
 *   [Paso 2] Preguntas · https://…/apply · root [role="dialog"]
 *     Inputs: 5 en la página, 3 vacíos → IA
 *       · years [text*] "¿Años de experiencia con Node?"
 *     IA:
 *       ✔ years = "4" (0.90)
 *       ✖ phone → vacío (confianza 0.30 < 0.5)
 *     Navegador:
 *       type   years ← "4"
 *       click  botón "Siguiente" (next)
 *     Resultado: avanzó al siguiente paso
 */
export class FormStepReport {
  private readonly lines: string[] = [];

  constructor(step: number, rootSelector: string, snapshot: DomSnapshot) {
    const title = snapshot.heading ? `${snapshot.heading} · ` : '';
    this.lines.push(`[Paso ${step}] ${title}${snapshot.url} · root ${rootSelector}`);

    const empty = snapshot.fields.length;
    this.lines.push(
      `  Inputs: ${snapshot.inputCount} en la página, ${empty} vacíos${empty ? ' → IA' : ' (nada que llenar)'}`,
    );
    for (const field of snapshot.fields) {
      this.lines.push(`    · ${field.key} [${describeType(field)}] "${field.label}"`);
    }
  }

  /** Lo que decidió la IA para cada campo y si se aplica o se descarta. */
  aiDecisions(fields: DomField[], results: FieldResult[], minConfidence: number): void {
    const answered = new Map(results.map((r) => [r.fieldName, r]));
    this.lines.push('  IA:');
    for (const field of fields) {
      const r = answered.get(field.key);
      if (!r) {
        this.lines.push(`    ✖ ${field.key} → sin respuesta de la IA`);
      } else if (r.value == null) {
        this.lines.push(`    ✖ ${field.key} → vacío (la IA no tiene el dato)`);
      } else if (r.confidence < minConfidence) {
        this.lines.push(
          `    ✖ ${field.key} → vacío (confianza ${r.confidence.toFixed(2)} < ${minConfidence})`,
        );
      } else {
        const review = r.requires_review ? ', revisar' : '';
        this.lines.push(
          `    ${r.requires_review ? '⚠' : '✔'} ${field.key} = ${quote(r.value)} (${r.confidence.toFixed(2)}${review})`,
        );
      }
    }
  }

  /** Acción ejecutada en el navegador (type, select, click…). */
  action(verb: string, target: string, detail = ''): void {
    if (!this.lines.includes('  Navegador:')) this.lines.push('  Navegador:');
    this.lines.push(`    ${verb.padEnd(6)} ${target}${detail ? ` ${detail}` : ''}`);
  }

  result(text: string): string {
    this.lines.push(`  Resultado: ${text}`);
    return this.lines.join('\n');
  }
}

/** Formatea el inventario de inputs y clickeables del contenedor. */
export function formatInventory(rootSelector: string, inv: DomInventory): string {
  const MAX = 40;
  const lines = [
    `inputs and clickeables relevant: root ${rootSelector} (${inv.rootFound ? (inv.rootInShadow ? 'encontrado dentro de shadow DOM' : 'encontrado') : 'NO encontrado → se usa body'}) · ${inv.url}`,
    `  Inputs: ${inv.inputs.length} en el root, ${inv.pageInputCount} en toda la página`,
  ];
  for (const i of inv.inputs.slice(0, MAX)) {
    const mark = i.status.startsWith('vacío') ? '✔' : '·';
    lines.push(`    ${mark} ${i.key} [${i.type}${i.required ? '*' : ''}] "${i.label}" → ${i.status}`);
  }
  if (inv.inputs.length > MAX) lines.push(`    … y ${inv.inputs.length - MAX} más`);
  if (inv.inputs.length === 0) lines.push('    (ninguno: la IA no recibirá campos en este paso)');

  lines.push(`  Clickeables: ${inv.clickables.length}`);
  for (const c of inv.clickables.slice(0, MAX)) {
    lines.push(`    [${c.tag}] "${c.text}"${c.disabled ? ' (disabled)' : ''}`);
  }
  if (inv.clickables.length > MAX) lines.push(`    … y ${inv.clickables.length - MAX} más`);

  if (inv.iframes.length) {
    lines.push(`  ⚠ iframes (${inv.iframes.length}), sus campos NO se analizan: ${inv.iframes.join(', ')}`);
  }
  if (inv.shadowHosts.length) {
    lines.push(
      `  ⚠ shadow DOM (${inv.shadowHosts.length}), sus campos NO se analizan: ${[...new Set(inv.shadowHosts)].join(', ')}`,
    );
  }
  return lines.join('\n');
}

function describeType(field: DomField): string {
  const required = field.required ? '*' : '';
  if (!field.options?.length || field.type === 'checkbox') return `${field.type}${required}`;
  const options = field.options.map((o) => o.value);
  const shown = options.length > 5 ? [...options.slice(0, 5), `+${options.length - 5}`] : options;
  return `${field.type}${required}: ${shown.join('|')}`;
}

export function quote(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ');
  return JSON.stringify(
    oneLine.length > MAX_VALUE_LENGTH ? `${oneLine.slice(0, MAX_VALUE_LENGTH)}…` : oneLine,
  );
}
