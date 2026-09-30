import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'puppeteer';
import { EasyApplyButtonClicker } from '../contract/easy.apply.button.clicker';
import { HumanBehaviorService } from '../../../common/human-behavior.service';

/**
 * Busca el botón de "Easy Apply" (Solicitud sencilla) en la página.
 * LinkedIn cambia las clases CSS dinámicamente, así que buscamos por texto
 * estable o aria-label en lugar de depender de una clase concreta.
 * El botón puede ser <button>, <a role="button"> o <div role="button">.
 *
 * IMPORTANTE (Puppeteer v25): las funciones NO se pueden pasar como
 * argumentos a page.evaluate/waitForFunction — se serializan como
 * `undefined` dentro del navegador. Esta función se pasa como pageFunction
 * (primer argumento), que sí se serializa correctamente.
 *
 * El nuevo diseño de LinkedIn usa un <a> plano (sin role="button") con
 * href hacia /apply/?openSDUIApplyFlow=true, así que también lo buscamos
 * por href.
 */
function findEasyApplyButton(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll(
      'button, a[role="button"], [role="button"], a[href*="/apply/"], a[href*="openSDUIApplyFlow"]',
    ),
  );
  const btn = candidates.find((b) => {
    const text = (b.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
    const href = (b.getAttribute('href') ?? '').toLowerCase();
    return (
      text.includes('solicitud sencilla') ||
      text.includes('easy apply') ||
      text.includes('solicitar') ||
      label.includes('solicitud sencilla') ||
      label.includes('solicitar') ||
      label.includes('easy apply') ||
      href.includes('/apply/') ||
      href.includes('solicitar') ||
      href.includes('opendsuiapplyflow')
    );
  });
  return (btn as HTMLElement) ?? null;
}

@Injectable()
export class EasyApplyButtonClickerImpl implements EasyApplyButtonClicker {
  private readonly logger = new Logger(EasyApplyButtonClickerImpl.name);

  constructor(private readonly human: HumanBehaviorService) {}

  /** Captura los botones candidatos y el estado del botón Easy Apply. */
  private async captureDebug(page: Page): Promise<{
    total: number;
    texts: (string | undefined)[];
    labels: (string | null)[];
    hrefs: (string | null)[];
    found: boolean;
  }> {
    // La lógica de búsqueda va inline: el navegador no tiene acceso a
    // funciones definidas en Node (findEasyApplyButton no existe allí).
    return page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          'button, a[role="button"], [role="button"], a[href*="/apply/"], a[href*="openSDUIApplyFlow"]',
        ),
      );
      const btn = candidates.find((b) => {
        const text = (b.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
        const href = (b.getAttribute('href') ?? '').toLowerCase();
        return (
          text.includes('solicitud sencilla') ||
          text.includes('easy apply') ||
          label.includes('solicitud sencilla') ||
          label.includes('easy apply') ||
          href.includes('/apply/') ||
          href.includes('opendsuiapplyflow')
        );
      });
      return {
        total: candidates.length,
        texts: candidates.map((b) => b.textContent?.trim()),
        labels: candidates.map((b) => b.getAttribute('aria-label')),
        hrefs: candidates.map((b) => b.getAttribute('href')),
        found: btn !== null && btn !== undefined,
      };
    });
  }

  private logDebug(debug: {
    total: number;
    texts: (string | undefined)[];
    labels: (string | null)[];
    hrefs: (string | null)[];
    found: boolean;
  }): void {
    this.logger.debug(
      `Easy Apply candidates (${debug.total}, found=${debug.found}): ` +
        `texts=${JSON.stringify(debug.texts)} ` +
        `labels=${JSON.stringify(debug.labels)} ` +
        `hrefs=${JSON.stringify(debug.hrefs)}`,
    );
  }

  async click(page: Page): Promise<boolean> {
    // Log inicial: estado de la página justo después de cargar la oferta.
    // Así vemos qué botones hay aunque luego el waitForFunction falle.
    // Esperamos a que aparezca el botón porque LinkedIn renderiza el
    // contenido dinámicamente después de 'domcontentloaded'.
    // 15s máximo: si no aparece, mejor fallar rápido y pasar a la
    // siguiente vacante que quedarse esperando 60s.
    try {
      await page.waitForFunction(findEasyApplyButton, { timeout: 20_000 });
    } catch (error) {
      // En el timeout, logueamos el estado final para ver qué cambió
      // respecto al log inicial (por qué no apareció el botón).
      this.logDebug(await this.captureDebug(page));
      throw error;
    }

    // El debug se captura dentro del navegador y se devuelve a Node:
    // los console.log dentro de page.evaluate NO salen en la terminal
    // del servidor a menos que se reenvíen con page.on('console').
    // La lógica de búsqueda va inline (findEasyApplyButton no existe en
    // el navegador; las funciones no se serializan como argumentos).

    // Pausa humana antes de pulsar el botón.
    await this.human.wait();

    const result = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          'button, a[role="button"], [role="button"], a[href*="/apply/"], a[href*="openSDUIApplyFlow"]',
        ),
      );
      const btn = candidates.find((b) => {
        const text = (b.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
        const href = (b.getAttribute('href') ?? '').toLowerCase();
        return (
          text.includes('solicitud sencilla') ||
          text.includes('easy apply') ||
          label.includes('solicitud sencilla') ||
          label.includes('easy apply') ||
          href.includes('/apply/') ||
          href.includes('opendsuiapplyflow')
        );
      }) as HTMLElement | null;
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    this.logger.debug(`Easy Apply button clicked: ${result}`);

    // Pausa humana tras el click para dejar que el modal se abra.
    await this.human.wait();

    return result;
  }
}