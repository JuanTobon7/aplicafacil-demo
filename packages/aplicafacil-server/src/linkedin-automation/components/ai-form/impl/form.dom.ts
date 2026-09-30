/**
 * Funciones que se ejecutan DENTRO del navegador (page.evaluate).
 *
 * IMPORTANTE (Puppeteer): cada función se serializa con toString(), así que
 * debe ser autocontenida: nada de imports ni helpers definidos fuera de ella.
 * Se pasan siempre como primer argumento de page.evaluate.
 */

export interface DomFieldOption {
  value: string;
  label: string;
}

export interface DomField {
  /** Clave única del campo en este paso; también queda en `data-af-key`. */
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: DomFieldOption[];
}

export interface DomSnapshot {
  /** false si el contenedor del formulario ya no existe (p.ej. modal cerrado). */
  rootFound: boolean;
  /** Campos visibles que siguen VACÍOS (los ya llenos no se tocan). */
  fields: DomField[];
  /** Nº total de campos del paso (llenos o vacíos). */
  inputCount: number;
  /** Firma del paso actual: si no cambia tras avanzar, el formulario está bloqueado. */
  fingerprint: string;
  /** Mensajes de validación visibles. */
  errors: string[];
  /** La página muestra una confirmación de solicitud enviada. */
  success: boolean;
}

export type AdvanceKind = 'submit' | 'review' | 'next';

export function snapshotForm(rootSelector: string): DomSnapshot {
  const root = document.querySelector(rootSelector);
  const scope: Element = root ?? document.body;

  const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
  const labelOf = (el: HTMLElement): string => {
    const input = el as HTMLInputElement;
    const labelledBy = el.getAttribute('aria-labelledby');
    const byId = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText ?? '')
          .join(' ')
      : '';
    return clean(
      input.labels?.[0]?.innerText ||
        el.getAttribute('aria-label') ||
        byId ||
        el.closest('fieldset')?.querySelector('legend')?.innerText ||
        input.placeholder ||
        input.name,
    );
  };
  const isPlaceholderOption = (text: string) =>
    /select|selecciona|seleccione|choose|elige|^-+$/i.test(text);

  const used = new Set<string>();
  const uniqueKey = (base: string) => {
    const prefix = base || 'field';
    let key = prefix;
    for (let i = 1; used.has(key); i++) key = `${prefix}__${i}`;
    used.add(key);
    return key;
  };

  const fields: DomField[] = [];
  const radioGroups = new Map<string, HTMLInputElement[]>();
  const allNames: string[] = [];
  const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search'];

  const elements = Array.from(
    scope.querySelectorAll('input, textarea, select'),
  ) as HTMLElement[];

  for (const el of elements) {
    const input = el as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    const type =
      tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (input.type || 'text').toLowerCase();

    if (skipTypes.includes(type) || input.disabled || input.readOnly) continue;
    // Buscadores y navegación del sitio no son parte del formulario.
    if (el.closest('[role="search"], header, nav, footer')) continue;
    // La firma solo cuenta lo visible: los pasos ocultos no deben pesar.
    const shown = visible(el) || (input.labels?.[0] ? visible(input.labels[0]) : false);
    if (shown) allNames.push(input.name || el.id || type);

    if (type === 'radio') {
      const group = input.name || labelOf(el);
      if (!radioGroups.has(group)) radioGroups.set(group, []);
      radioGroups.get(group)!.push(input);
      continue;
    }
    if (!visible(el)) continue;

    // Los campos ya llenos (p.ej. email/teléfono precargados) no se tocan.
    if (type === 'checkbox') {
      if (input.checked) continue;
    } else if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const selected = select.options[select.selectedIndex];
      if (selected && selected.value && !isPlaceholderOption(clean(selected.text))) continue;
    } else if (input.value.trim()) {
      continue;
    }

    const key = uniqueKey(input.name || el.id);
    el.setAttribute('data-af-key', key);
    fields.push({
      key,
      label: labelOf(el),
      type,
      required: input.required || el.getAttribute('aria-required') === 'true',
      placeholder: input.placeholder || undefined,
      options:
        tag === 'select'
          ? Array.from((el as HTMLSelectElement).options)
              .filter((o) => o.value && !isPlaceholderOption(clean(o.text)))
              .map((o) => ({ value: o.value, label: clean(o.text) }))
          : type === 'checkbox'
            ? [
                { value: 'true', label: 'Marcar' },
                { value: 'false', label: 'Dejar sin marcar' },
              ]
            : undefined,
    });
  }

  for (const [group, radios] of radioGroups) {
    if (radios.some((r) => r.checked)) continue;
    const key = uniqueKey(group);
    radios.forEach((r) => r.setAttribute('data-af-key', key));
    fields.push({
      key,
      label: clean(radios[0].closest('fieldset')?.querySelector('legend')?.innerText) || group,
      type: 'radio',
      required: radios.some((r) => r.required || r.getAttribute('aria-required') === 'true'),
      options: radios.map((r) => {
        const label = clean(r.labels?.[0]?.innerText);
        return { value: r.value || label, label: label || r.value };
      }),
    });
  }

  const errors = Array.from(
    scope.querySelectorAll('[role="alert"], .artdeco-inline-feedback--error, [aria-invalid="true"]'),
  )
    .filter(visible)
    .map((e) => {
      const el = e as HTMLElement;
      return clean(el.innerText) || (el.matches('input, select, textarea') ? `Campo inválido: ${labelOf(el)}` : '');
    })
    .filter(Boolean);

  const heading = clean(
    (Array.from(scope.querySelectorAll('h1, h2, h3')).find(visible) as HTMLElement | undefined)?.innerText,
  );
  const progress =
    scope.querySelector('progress, [role="progressbar"]')?.getAttribute('aria-valuenow') ?? '';

  return {
    rootFound: root !== null,
    fields,
    inputCount: allNames.length,
    fingerprint: [location.href, heading, progress, allNames.join(',')].join('|'),
    errors,
    success:
      /application (was )?sent|your application was submitted|solicitud enviada|se envi[oó] tu solicitud|thank(s| you) for (applying|your application)|gracias por (tu|su) (postulaci[oó]n|solicitud|aplicaci[oó]n)|application received|hemos recibido tu/i.test(
        document.body.innerText,
      ),
  };
}

/**
 * Busca el botón para avanzar (enviar > revisar > siguiente), lo marca con
 * `data-af-advance` para poder pulsarlo desde Node con comportamiento humano.
 */
export function markAdvanceButton(
  rootSelector: string,
): { kind: AdvanceKind; text: string } | null {
  const scope: Element = document.querySelector(rootSelector) ?? document.body;
  const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

  document
    .querySelectorAll('[data-af-advance]')
    .forEach((b) => b.removeAttribute('data-af-advance'));

  const buttons = Array.from(
    scope.querySelectorAll('button, input[type="submit"], [role="button"]'),
  ).filter((b) => {
    const el = b as HTMLButtonElement;
    return el.getClientRects().length > 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  });

  const textOf = (b: Element) =>
    clean(
      `${(b as HTMLElement).innerText || (b as HTMLInputElement).value || ''} ${b.getAttribute('aria-label') ?? ''}`,
    ).toLowerCase();

  const exclude =
    /atr[aá]s|\bback\b|anterior|previous|cancel|descartar|dismiss|cerrar|close|guardar|\bsave\b|editar|\bedit\b|eliminar|remove|borrar|share|compartir/;
  const patterns: Array<[AdvanceKind, RegExp]> = [
    ['submit', /submit|enviar|send application|apply now|postular|aplicar|solicitar|finish|finalizar/],
    ['review', /review|revisar/],
    ['next', /\bnext\b|continue|continuar|siguiente|proceed/],
  ];

  for (const [kind, re] of patterns) {
    const button = buttons.find((b) => {
      const text = textOf(b);
      return re.test(text) && !exclude.test(text);
    });
    if (button) {
      button.setAttribute('data-af-advance', '1');
      return { kind, text: textOf(button) };
    }
  }
  return null;
}
