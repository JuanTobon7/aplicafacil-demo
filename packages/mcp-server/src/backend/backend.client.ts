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

  constructor(baseURL: string, timeoutMs = 5000) {
    this.http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
    httpInterceptor.applyTo(this.http, 'Backend');
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
