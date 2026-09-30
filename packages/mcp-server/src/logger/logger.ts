/**
 * Logger Utility - Centralized logging for the MCP Server
 *
 * Escribe SIEMPRE a stderr: en modo stdio, stdout es el canal del protocolo MCP.
 */
export class Logger {
  private timestamp(): string {
    return new Date().toISOString();
  }

  info(message: string, data?: any) {
    console.error(`[${this.timestamp()}] ℹ️  INFO: ${message}`, data || '');
  }

  debug(message: string, data?: any) {
    console.error(`[${this.timestamp()}] 🐛 DEBUG: ${message}`, data || '');
  }

  warn(message: string, data?: any) {
    console.error(`[${this.timestamp()}] ⚠️  WARN: ${message}`, data || '');
  }

  error(message: string, error?: any) {
    console.error(
      `[${this.timestamp()}] ❌ ERROR: ${message}`,
      error instanceof Error ? error.message : error || ''
    );
  }

  success(message: string, data?: any) {
    console.error(`[${this.timestamp()}] ✅ SUCCESS: ${message}`, data || '');
  }
}

export const logger = new Logger();
