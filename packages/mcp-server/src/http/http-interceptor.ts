import { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { logger } from '../logger/logger.js';

/**
 * Extended config interface to hold interceptor metadata
 */
interface InterceptorMetadata {
  _interceptorId: number;
  _startTime: number;
}

type WithMetadata<T> = T & InterceptorMetadata;

/**
 * HTTP Interceptor
 *
 * Logs every outgoing HTTP request and its response with:
 * - Unique request ID for correlation
 * - HTTP method, full URL, headers, body (truncated if large)
 * - Response status, timing, headers, body
 * - Error details on failure
 *
 * Attach to any Axios instance via `applyTo()`.
 */
export class HttpInterceptor {
  private requestCounter = 0;

  /**
   * Apply request/response interceptors to an Axios instance.
   *
   * @param instance - The Axios instance to intercept
   * @param serviceName - A human-readable label (e.g. "Backend", "OpenRouter")
   */
  applyTo(instance: AxiosInstance, serviceName: string = 'HTTP'): void {
    // ── Request interceptor ──────────────────────────────────────────
    instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const id = ++this.requestCounter;
        const meta = config as unknown as WithMetadata<InternalAxiosRequestConfig>;
        meta._interceptorId = id;
        meta._startTime = Date.now();

        const method = (config.method ?? 'GET').toUpperCase();
        const url = this.buildUrl(config);

        logger.info(`🌐 [${id}] ${serviceName} ──➡️  ${method} ${url}`);

        // Log request details at debug level to keep info concise
        logger.debug(`🌐 [${id}] ${serviceName} request details`, {
          method,
          url,
          headers: this.sanitizeHeaders(config.headers),
          body: this.serializeBody(config.data),
        });

        return config;
      },
      (error) => {
        logger.error(`🌐 ${serviceName} ❌ Request interceptor error`, error);
        return Promise.reject(error);
      },
    );

    // ── Response interceptor ─────────────────────────────────────────
    instance.interceptors.response.use(
      (response: AxiosResponse) => {
        const meta = response.config as unknown as WithMetadata<InternalAxiosRequestConfig>;
        const id = meta._interceptorId ?? '?';
        const duration = meta._startTime ? Date.now() - meta._startTime : -1;

        logger.info(
          `🌐 [${id}] ${serviceName} ⬅️  ${response.status} ${response.statusText} (${duration}ms)`,
        );

        logger.debug(`🌐 [${id}] ${serviceName} response details`, {
          status: response.status,
          duration: `${duration}ms`,
          headers: this.sanitizeHeaders(response.headers),
          body: this.serializeBody(response.data),
        });

        return response;
      },
      (error) => {
        if (error.response) {
          // Server responded with an error status
          const meta = error.config as unknown as WithMetadata<InternalAxiosRequestConfig> | undefined;
          const id = meta?._interceptorId ?? '?';
          const duration = meta?._startTime ? Date.now() - meta._startTime : -1;

          const resp = error.response as AxiosResponse;
          logger.error(
            `🌐 [${id}] ${serviceName} ❌ ${resp.status} ${resp.statusText} (${duration}ms)`,
            {
              responseBody: this.serializeBody(resp.data),
            },
          );
        } else if (error.request) {
          // Request was sent but no response received
          const meta = error.config as unknown as WithMetadata<InternalAxiosRequestConfig> | undefined;
          const id = meta?._interceptorId ?? '?';
          logger.error(`🌐 [${id}] ${serviceName} ❌ No response received`, {
            message: error.message,
            code: error.code,
          });
        } else {
          // Something else went wrong
          logger.error(`🌐 ${serviceName} ❌ Request setup error`, {
            message: error.message,
          });
        }

        return Promise.reject(error);
      },
    );
  }

  // ── Private helpers ────────────────────────────────────────────────

  private buildUrl(config: InternalAxiosRequestConfig): string {
    const base = config.baseURL ?? '';
    const url = config.url ?? '';
    // Avoid double slashes
    const joined = base.endsWith('/') && url.startsWith('/') ? base + url.slice(1) : base + url;
    return joined || 'unknown';
  }

  private sanitizeHeaders(headers: any): Record<string, string> {
    if (!headers) return {};

    const SENSITIVE_KEYS = ['authorization', 'api-key', 'x-api-key', 'cookie', 'set-cookie'];
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.includes(lower)) {
        result[key] = '***REDACTED***';
      } else {
        result[key] = String(value);
      }
    }

    return result;
  }

  private serializeBody(data: unknown): unknown {
    if (data === undefined || data === null) return undefined;

    try {
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const MAX_LENGTH = 3000;

      if (str.length > MAX_LENGTH) {
        return `${str.slice(0, MAX_LENGTH)}\n… [truncated ${str.length - MAX_LENGTH} more chars]`;
      }

      // Try to parse back as object for better console display
      try {
        return JSON.parse(str);
      } catch {
        return str;
      }
    } catch {
      return String(data);
    }
  }
}

/** Singleton instance */
export const httpInterceptor = new HttpInterceptor();
