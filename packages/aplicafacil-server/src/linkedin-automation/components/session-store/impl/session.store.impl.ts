import { Injectable, Logger } from '@nestjs/common';
import { CookieData, Page } from 'puppeteer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionStore } from '../contract/session.store';

/**
 * Implementación de SessionStore basada en archivos.
 *
 * Guarda las cookies de la sesión de LinkedIn en un JSON (formato
 * compatible con el `storageState` de Playwright) para reutilizar la
 * sesión entre ejecuciones del navegador y no tener que loguearse
 * cada vez.
 *
 * La ruta se configura con la variable de entorno `LINKEDIN_STORAGE_STATE`
 * (por defecto: `storage-state/linkedin-session.json` relativo a la raíz
 * del servidor).
 */
@Injectable()
export class SessionStoreImpl implements SessionStore {
  private readonly logger = new Logger(SessionStoreImpl.name);

  private readonly sessionFilePath: string;

  constructor() {
    const configuredPath =
      process.env.LINKEDIN_STORAGE_STATE ??
      path.join('storage-state', 'linkedin-session.json');

    this.sessionFilePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  async save(page: Page): Promise<void> {
    const cookies = await page.browserContext().cookies();

    if (cookies.length === 0) {
      this.logger.warn(
        'No cookies to save. Skipping session persistence.',
      );
      return;
    }

    const storageState = {
      cookies,
      origins: [],
    };

    await fs.promises.mkdir(path.dirname(this.sessionFilePath), {
      recursive: true,
    });
    await fs.promises.writeFile(
      this.sessionFilePath,
      JSON.stringify(storageState, null, 2),
      'utf-8',
    );

    this.logger.debug(
      `LinkedIn session saved (${cookies.length} cookies) to ${this.sessionFilePath}`,
    );
  }

  async load(page: Page): Promise<boolean> {
    if (!fs.existsSync(this.sessionFilePath)) {
      this.logger.debug(
        `No saved LinkedIn session found at ${this.sessionFilePath}`,
      );
      return false;
    }

    try {
      const raw = await fs.promises.readFile(
        this.sessionFilePath,
        'utf-8',
      );
      const storageState = JSON.parse(raw) as {
        cookies?: CookieData[];
      };

      const cookies = storageState.cookies ?? [];
      if (cookies.length === 0) {
        this.logger.warn(
          'Saved session file is empty. Ignoring it.',
        );
        return false;
      }

      await page.browserContext().setCookie(...cookies);

      this.logger.debug(
        `LinkedIn session restored (${cookies.length} cookies) from ${this.sessionFilePath}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not restore LinkedIn session: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return false;
    }
  }

  async clear(): Promise<void> {
    if (fs.existsSync(this.sessionFilePath)) {
      await fs.promises.unlink(this.sessionFilePath);
      this.logger.log(
        `LinkedIn session file removed: ${this.sessionFilePath}`,
      );
    }
  }
}