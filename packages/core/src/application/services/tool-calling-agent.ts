import { AiCompletionPort } from '../ports/ai-completion.port.js';
import {
  ChatMessage,
  ChatModelPort,
  ToolCall,
  ToolDefinition,
} from '../ports/chat-model.port.js';
import { LoggerPort } from '../ports/logger.port.js';
import { ToolGatewayPort } from '../ports/tool-gateway.port.js';

const FINAL_ANSWER_NUDGE =
  'Ya no puedes usar más herramientas. Responde ahora con la respuesta final en el formato pedido.';

/**
 * Agente de tool-calling: implementa AiCompletionPort sobre un LLM con tools.
 *
 * Flujo (el patrón host ↔ MCP):
 *   1. Descubre las tools disponibles en el gateway (MCP `tools/list`).
 *   2. Envía la conversación + tools al LLM.
 *   3. Si el LLM pide tools, las ejecuta vía gateway (MCP `tools/call`) y le
 *      devuelve los resultados. Repite hasta que el LLM responda sin tools.
 *
 * Es el LLM quien decide qué tools usar; los use cases no conocen ninguna.
 */
export class ToolCallingAgent implements AiCompletionPort {
  constructor(
    private readonly model: ChatModelPort,
    private readonly tools: ToolGatewayPort,
    private readonly logger: LoggerPort,
    private readonly maxSteps: number = 6,
  ) {}

  async complete(request: {
    system: string;
    prompt: string;
    data?: string;
  }): Promise<string> {
    const tools = await this.discoverTools();

    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ];
    if (request.data !== undefined) {
      messages.push({ role: 'user', content: request.data });
    }

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await this.model.chat({ messages, tools });

      if (response.toolCalls.length === 0) {
        this.logger.info(
          step === 0
            ? 'LLM respondió SIN usar tools MCP (decidió que no necesitaba datos del candidato)'
            : `LLM respondió tras ${step} ronda(s) de tools MCP`,
        );
        return response.content ?? '';
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: await this.runTool(call),
        });
      }
    }

    this.logger.warn(
      `Agente alcanzó el máximo de ${this.maxSteps} pasos; forzando respuesta final`,
    );
    messages.push({ role: 'user', content: FINAL_ANSWER_NUDGE });
    const final = await this.model.chat({ messages });
    return final.content ?? '';
  }

  private async discoverTools(): Promise<ToolDefinition[]> {
    try {
      const tools = await this.tools.listTools();
      this.logger.info(
        `Tools MCP ofrecidas al LLM: ${tools.map((t) => t.name).join(', ') || '(ninguna)'}`,
      );
      return tools;
    } catch (error) {
      // Sin tools el LLM aún puede responder con el contexto del prompt.
      this.logger.warn(
        `No se pudieron listar tools, se continúa sin ellas: ${errorMessage(error)}`,
      );
      return [];
    }
  }

  private async runTool(call: ToolCall): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      return `Error: argumentos inválidos para "${call.name}" (no es JSON válido)`;
    }

    this.logger.info(`LLM invoca tool MCP "${call.name}" ${JSON.stringify(args)}`);
    try {
      const result = await this.tools.callTool(call.name, args);
      if (result.isError) {
        this.logger.warn(`Tool "${call.name}" devolvió error: ${result.content}`);
      } else {
        this.logger.info(`Tool "${call.name}" respondió ${result.content.length} caracteres`);
      }
      return result.content;
    } catch (error) {
      this.logger.error(`Fallo ejecutando tool "${call.name}": ${errorMessage(error)}`);
      return `Error: ${errorMessage(error)}`;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
