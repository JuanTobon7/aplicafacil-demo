import { createHmac } from 'node:crypto';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { PeopleDto, ProfileResponseDto } from '@aplicafacil/core/domain';
import { httpInterceptor } from '../http/http-interceptor.js';

/**
 * Cliente único del backend (aplicafacil-server).
 *
 * TODAS las tools/resources del MCP server consultan datos por aquí: misma
 * base URL, mismo timeout, mismo logging y los mismos errores normalizados.
 */
export class BackendClient {
  private readonly http: AxiosInstance;
  private serviceToken: { value: string; expiresAt: number } | null = null;

  /**
   * @param jwtSecret mismo JWT_SECRET que el backend: el MCP server se
   *                  autentica como servicio con un JWT propio de corta duración.
   */
  constructor(
    baseURL: string,
    private readonly jwtSecret: string | undefined,
    timeoutMs = 5000,
  ) {
    this.http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
    this.http.interceptors.request.use((config) => {
      const token = this.getServiceToken();
      if (token) config.headers.set('Authorization', `Bearer ${token}`);
      return config;
    });
    httpInterceptor.applyTo(this.http, 'Backend');
  }

  /** JWT HS256 de servicio (1 h), renovado 5 min antes de expirar. */
  private getServiceToken(): string | null {
    if (!this.jwtSecret) return null;
    const now = Math.floor(Date.now() / 1000);
    if (this.serviceToken && this.serviceToken.expiresAt - 300 > now) {
      return this.serviceToken.value;
    }

    const expiresAt = now + 3600;
    const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: 'mcp-server',
      username: 'mcp-server',
      personId: '',
      iat: now,
      exp: expiresAt,
    })}`;
    const signature = createHmac('sha256', this.jwtSecret).update(unsigned).digest('base64url');

    this.serviceToken = { value: `${unsigned}.${signature}`, expiresAt };
    return this.serviceToken.value;
  }

  getProfile(profileId: string): Promise<ProfileResponseDto> {
    return this.get(`/profiles/${encodeURIComponent(profileId)}`);
  }

  getPerson(personId: string): Promise<PeopleDto> {
    return this.get(`/people/${encodeURIComponent(personId)}`);
  }

  private async get<T>(path: string): Promise<T> {
    try {
      const response = await this.http.get<T>(path);
      return response.data;
    } catch (error) {
      throw toBackendError(path, error);
    }
  }
}

function toBackendError(path: string, error: unknown): Error {
  if (isAxiosError(error)) {
    if (error.response) {
      const body = error.response.data as { message?: unknown } | undefined;
      const detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
      return new Error(`Backend respondió ${error.response.status} en ${path}${detail}`);
    }
    return new Error(`Backend no disponible (${path}): ${error.message || error.code}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
