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
  /** URL y título visible del paso (para el reporte de logs). */
  url: string;
  heading: string;
  /** Campos visibles que siguen VACÍOS (los ya llenos no se tocan). */
  fields: DomField[];
  /** Campos visibles ya llenos (contexto para la IA). */
  filled: Array<{ label: string; value: string }>;
  /** Botones / inputs de archivo del paso; `id` queda en `data-af-click`. */
  clickables: DomClickable[];
  /** Nº total de campos del paso (llenos o vacíos). */
  inputCount: number;
  /** Firma del paso actual: si no cambia tras avanzar, el formulario está bloqueado. */
  fingerprint: string;
  /** Mensajes de validación visibles. */
  errors: string[];
  /** La página muestra una confirmación de solicitud enviada. */
  success: boolean;
}

export type ClickableKind = 'submit' | 'review' | 'next' | 'upload' | 'other';

export interface DomClickable {
  id: string;
  text: string;
  kind: ClickableKind;
}

export interface DomInventory {
  rootFound: boolean;
  /** El contenedor está dentro de un shadow DOM. */
  rootInShadow: boolean;
  url: string;
  /** Inputs en toda la página (para comparar con los que hay en el root). */
  pageInputCount: number;
  inputs: Array<{ key: string; type: string; label: string; required: boolean; status: string }>;
  clickables: Array<{ tag: string; text: string; disabled: boolean }>;
  /** iframes dentro del root: sus campos NO se analizan. */
  iframes: string[];
  /** Elementos con shadow DOM abierto dentro del root: sus campos NO se analizan. */
  shadowHosts: string[];
}

/**
 * Inventario de diagnóstico: TODOS los inputs y clickeables del contenedor,
 * con el motivo por el que cada input se envía o no a la IA (mismos filtros
 * que snapshotForm). Sirve para entender por qué un campo no se analiza.
 */
export function inventoryForm(rootSelector: string): DomInventory {
  // Busca también dentro de shadow DOM abiertos (LinkedIn monta el modal de
  // Easy Apply dentro de un shadowRoot, invisible para document.querySelector).
  const shadowScopes: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < shadowScopes.length; i++) {
    shadowScopes[i].querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) shadowScopes.push(el.shadowRoot);
    });
  }
  const deepQuery = (sel: string): Element | null => {
    for (const s of shadowScopes) {
      const found = s.querySelector(sel);
      if (found) return found;
    }
    return null;
  };
  const root = deepQuery(rootSelector);
  const scope: Element = root ?? document.body;
  const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
  const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  const labelOf = (el: HTMLElement): string => {
    const input = el as HTMLInputElement;
    return clean(
      input.labels?.[0]?.innerText ||
        el.getAttribute('aria-label') ||
        el.closest('fieldset')?.querySelector('legend')?.innerText ||
        input.placeholder,
    );
  };
  const isPlaceholderOption = (text: string) =>
    /select|selecciona|seleccione|choose|elige|^-+$/i.test(text);
  const skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password', 'search'];

  const inputs = (Array.from(scope.querySelectorAll('input, textarea, select')) as HTMLElement[]).map(
    (el) => {
      const input = el as HTMLInputElement;
      const tag = el.tagName.toLowerCase();
      const type =
        tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (input.type || 'text').toLowerCase();

      let status: string;
      if (skipTypes.includes(type)) status = `ignorado (tipo ${type})`;
      else if (input.disabled) status = 'ignorado (disabled)';
      else if (input.readOnly) status = 'ignorado (readonly)';
      else if (el.closest('[role="search"], header, nav, footer')) status = 'ignorado (header/nav/footer)';
      else if (type === 'radio') status = input.checked ? 'ya marcado' : 'vacío → IA (grupo radio)';
      else if (!visible(el)) status = 'ignorado (no visible)';
      else if (type === 'checkbox') status = input.checked ? 'ya marcado' : 'vacío → IA';
      else if (tag === 'select') {
        const selected = (el as HTMLSelectElement).options[(el as HTMLSelectElement).selectedIndex];
        status =
          selected && selected.value && !isPlaceholderOption(clean(selected.text))
            ? `ya lleno ("${short(clean(selected.text))}")`
            : 'vacío → IA';
      } else status = input.value.trim() ? `ya lleno ("${short(input.value.trim())}")` : 'vacío → IA';

      return {
        key: input.name || el.id || '(sin name/id)',
        type,
        label: short(labelOf(el)),
        required: input.required || el.getAttribute('aria-required') === 'true',
        status,
      };
    },
  );

  const clickables = Array.from(
    scope.querySelectorAll('button, input[type="submit"], [role="button"], a[role="button"]'),
  )
    .filter(visible)
    .map((b) => ({
      tag: b.tagName.toLowerCase(),
      text: short(
        clean(
          `${(b as HTMLElement).innerText || (b as HTMLInputElement).value || ''} ${b.getAttribute('aria-label') ?? ''}`,
        ),
      ),
      disabled: (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true',
    }));

  return {
    rootFound: root !== null,
    rootInShadow: !!root && root.getRootNode() instanceof ShadowRoot,
    url: location.href,
    pageInputCount: shadowScopes.reduce(
      (n, s) => n + s.querySelectorAll('input, textarea, select').length,
      0,
    ),
    inputs,
    clickables,
    iframes: Array.from(scope.querySelectorAll('iframe')).map((f) => short(f.src || '(sin src)')),
    shadowHosts: Array.from(scope.querySelectorAll('*'))
      .filter((el) => el.shadowRoot)
      .map((el) => el.tagName.toLowerCase()),
  };
}

export function snapshotForm(rootSelector: string): DomSnapshot {
  // Busca también dentro de shadow DOM abiertos (LinkedIn monta el modal de
  // Easy Apply dentro de un shadowRoot, invisible para document.querySelector).
  const shadowScopes: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < shadowScopes.length; i++) {
    shadowScopes[i].querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) shadowScopes.push(el.shadowRoot);
    });
  }
  const deepQuery = (sel: string): Element | null => {
    for (const s of shadowScopes) {
      const found = s.querySelector(sel);
      if (found) return found;
    }
    return null;
  };
  const root = deepQuery(rootSelector);
  const scope: Element = root ?? document.body;

  // Los ids de la foto anterior ya no valen: se re-asignan en cada paso.
  shadowScopes.forEach((s) =>
    s.querySelectorAll('[data-af-key], [data-af-click]').forEach((el) => {
      el.removeAttribute('data-af-key');
      el.removeAttribute('data-af-click');
    }),
  );

  const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
  const labelOf = (el: HTMLElement): string => {
    const input = el as HTMLInputElement;
    const labelledBy = el.getAttribute('aria-labelledby');
    const byId = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => (el.getRootNode() as Document | ShadowRoot).getElementById(id)?.innerText ?? '')
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
  const filled: Array<{ label: string; value: string }> = [];
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
      if (input.checked) {
        filled.push({ label: labelOf(el), value: 'marcado' });
        continue;
      }
    } else if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const selected = select.options[select.selectedIndex];
      if (selected && selected.value && !isPlaceholderOption(clean(selected.text))) {
        filled.push({ label: labelOf(el), value: clean(selected.text) });
        continue;
      }
    } else if (input.value.trim()) {
      filled.push({ label: labelOf(el), value: input.value.trim().slice(0, 80) });
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
    const checked = radios.find((r) => r.checked);
    if (checked) {
      filled.push({ label: group, value: clean(checked.labels?.[0]?.innerText) || checked.value });
      continue;
    }
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

  // Mensajes de validación sin semántica (p.ej. <p>Se necesita un currículum</p>):
  // se reconocen por estar pintados en rojo.
  const isRed = (el: Element) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
    return !!m && +m[1] > 150 && +m[2] < 110 && +m[3] < 110;
  };
  for (const el of Array.from(scope.querySelectorAll('p, span, div'))) {
    if (el.children.length > 0 || !visible(el) || !isRed(el)) continue;
    const text = clean(el.textContent);
    if (text.length >= 3 && text.length <= 150 && !errors.includes(text)) errors.push(text);
  }

  // LinkedIn (SDUI) muestra la validación como texto de ayuda enlazado por
  // aria-describedby ("Introduce un número de teléfono válido").
  for (const el of elements) {
    const input = el as HTMLInputElement;
    const describedBy = el.getAttribute('aria-describedby');
    const invalid =
      el.getAttribute('aria-invalid') === 'true' ||
      ((input.required || el.getAttribute('aria-required') === 'true') && !input.value?.trim());
    if (!describedBy || !invalid || !visible(el)) continue;
    const text = clean(
      describedBy
        .split(/\s+/)
        .map((id) => (el.getRootNode() as Document | ShadowRoot).getElementById(id)?.textContent ?? '')
        .join(' '),
    );
    if (text) errors.push(`${labelOf(el)}: ${text}`);
  }

  // Clickeables con id: la IA decide cuál pulsar (avanzar, subir CV…).
  // Los input[type=file] suelen estar ocultos tras un botón: se incluyen igual.
  const uploadRe =
    /cargar (curr[ií]culum|cv)|subir (curr[ií]culum|cv|archivo)|upload (resume|cv|file)|attach (resume|cv)|adjuntar/;
  const submitRe = /submit|enviar|send application|apply now|postular|aplicar|solicitar|finish|finalizar/;
  const clickables: DomClickable[] = [];
  const clickableEls = Array.from(
    scope.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"], a[role="button"], label, input[type="file"]',
    ),
  );
  for (const el of clickableEls) {
    const isFile = el.matches('input[type="file"]');
    const text = clean(
      isFile
        ? `archivo ${(el as HTMLInputElement).accept || ''}`
        : `${(el as HTMLElement).innerText || (el as HTMLInputElement).value || ''} ${el.getAttribute('aria-label') ?? ''}`,
    );
    const lower = text.toLowerCase();
    // Los <label> solo cuentan si son el botón de subir archivo.
    if (el.tagName === 'LABEL' && !uploadRe.test(lower)) continue;
    if (!isFile && (!visible(el) || !text)) continue;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.closest('[role="search"], header, nav, footer')) continue;
    if (clickables.length >= 40) break;

    const kind: ClickableKind =
      isFile || uploadRe.test(lower)
        ? 'upload'
        : /atr[aá]s|\bback\b|anterior|previous|cancel|descartar|dismiss|cerrar|close|guardar|\bsave\b|editar|\bedit\b|eliminar|remove|borrar|share|compartir/.test(lower)
          ? 'other'
          : submitRe.test(lower)
            ? 'submit'
            : /review|revisar/.test(lower)
              ? 'review'
              : /\bnext\b|continue|continuar|siguiente|proceed/.test(lower)
                ? 'next'
                : 'other';
    const id = `c${clickables.length + 1}`;
    el.setAttribute('data-af-click', id);
    clickables.push({ id, text: text.slice(0, 80), kind });
  }

  const heading = clean(
    (Array.from(scope.querySelectorAll('h1, h2, h3')).find(visible) as HTMLElement | undefined)?.innerText,
  );
  const progress =
    scope.querySelector('progress, [role="progressbar"]')?.getAttribute('aria-valuenow') ?? '';

  return {
    rootFound: root !== null,
    url: location.href,
    heading,
    fields,
    filled,
    clickables,
    inputCount: allNames.length,
    fingerprint: [location.href, heading, progress, allNames.join(',')].join('|'),
    errors,
    success:
      /application (was )?sent|your application was submitted|solicitud enviada|se envi[oó] tu solicitud|thank(s| you) for (applying|your application)|gracias por (tu|su) (postulaci[oó]n|solicitud|aplicaci[oó]n)|application received|hemos recibido tu/i.test(
        [document.body.innerText, ...shadowScopes.slice(1).map((s) =>
          Array.from(s.children).map((c) => (c as HTMLElement).innerText ?? '').join(' '),
        )].join(' '),
      ),
  };
}

