import OpenAI from 'openai';
import { AiProvider } from '../../application/ports/ai-provider.js';
import {
  ChatMessage,
  ChatResponse,
  ToolDefinition,
} from '../../application/ports/chat-model.port.js';

export interface OpenAiCompatibleAdapterConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  embeddingModel: string;
  /** Fetch wrapper opcional para observabilidad (logging de tráfico). */
  fetch?: typeof fetch;
}

/**
 * Adapter base para cualquier proveedor con API compatible con OpenAI
 * (OpenRouter, OmniRoute, …): completación, chat con tools y embeddings.
 */
export class OpenAiCompatibleAdapter implements AiProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(config: OpenAiCompatibleAdapterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: config.fetch as any,
    });
    this.model = config.model;
    this.embeddingModel = config.embeddingModel;
  }

  async complete(request: {
    system: string;
    prompt: string;
    data?: string;
  }): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ];

    if (request.data !== undefined) {
      messages.push({ role: 'user', content: request.data });
    }

    const response = await this.chat({ messages });
    return response.content ?? '';
  }

  async chat(request: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): Promise<ChatResponse> {
    const tools = request.tools?.length
      ? request.tools.map(toOpenAiTool)
      : undefined;

    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: request.messages.map(toOpenAiMessage),
      tools,
    });

    const message = response.choices[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? [])
        .filter((call) => call.type === 'function')
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
    };
  }

  async getEmbedding(data: any): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: data,
    });
    return response.data[0].embedding;
  }
}

function toOpenAiTool(
  tool: ToolDefinition,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toOpenAiMessage(
  message: ChatMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (message.role) {
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls?.length
          ? message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.arguments },
            }))
          : undefined,
      };
    default:
      return message;
  }
}
