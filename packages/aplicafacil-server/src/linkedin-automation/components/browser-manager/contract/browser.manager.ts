import { Page } from 'puppeteer';

/**
 * Pestañas del navegador compartido, una por consumidor:
 * - `apply`: worker de la cola que postula a vacantes.
 * - `search`: cron de búsqueda de vacantes.
 */
export type BrowserTab = 'apply' | 'search';

/**
 * Dueño del ciclo de vida del navegador.
 *
 * Cada consumidor pide su pestaña con `getPage` y la libera con `releasePage`
 * al terminar. Cuando no queda ninguna pestaña abierta se cierra el navegador,
 * y la siguiente llamada a `getPage` lanza una instancia nueva.
 */
export abstract class BrowserManager {
  /** Devuelve la pestaña del consumidor, lanzando navegador/pestaña si hace falta. */
  abstract getPage(tab: BrowserTab): Promise<Page>;

  /** Cierra la pestaña del consumidor; si era la última, cierra el navegador. */
  abstract releasePage(tab: BrowserTab): Promise<void>;

  /** Cierra el navegador y todas sus pestañas. */
  abstract closeAll(): Promise<void>;
}
