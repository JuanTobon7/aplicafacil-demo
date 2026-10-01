import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AI_COMPLETION_PORT,
  CHAT_MODEL_PORT,
  TOOL_GATEWAY_PORT,
  ToolCallingAgent,
  type ChatModelPort,
  type ToolGatewayPort,
} from '@aplicafacil/core/application';
import {
  AiProviderFactory,
  OmniRouteAdapter,
  OpenRouterAdapter,
} from '@aplicafacil/core/infrastructure';
import { NestLoggerAdapter } from '../common/logger/nest-logger.adapter';
import { McpClientService } from './mcp-client.service';

/**
 * Host MCP de la aplicación.
 *
 * - CHAT_MODEL_PORT: el LLM (OpenRouter / OmniRoute según LLM_PROVIDER;
 *   "openrouter,omniroute" = cadena con failover).
 * - TOOL_GATEWAY_PORT: el cliente MCP conectado al mcp-server.
 * - AI_COMPLETION_PORT: agente que une ambos; el LLM decide qué tools usar.
 *
 * Los use cases (FillForm, ExtractCv) solo dependen de AI_COMPLETION_PORT.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    McpClientService,
    {
      provide: TOOL_GATEWAY_PORT,
      useExisting: McpClientService,
    },
    {
      provide: CHAT_MODEL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ChatModelPort =>
        new AiProviderFactory({
          provider: config.get<string>('LLM_PROVIDER') ?? 'openrouter',
          openRouter: new OpenRouterAdapter({
            apiKey: config.get<string>('OPENROUTER_API_KEY') ?? '',
            baseURL:
              config.get<string>('OPENROUTER_BASE_URL') ??
              'https://openrouter.ai/api/v1',
            model: config.get<string>('OPENROUTER_MODEL'),
            embeddingModel: config.get<string>('OPENROUTER_EMBEDDING_MODEL'),
          }),
          logger: new NestLoggerAdapter('AiProvider'),
          omniRoute: new OmniRouteAdapter({
            apiKey: config.get<string>('OMNIROUTE_API_KEY'),
            baseURL: config.get<string>('OMNIROUTE_BASE_URL'),
            model: config.get<string>('OMNIROUTE_MODEL'),
            embeddingModel: config.get<string>('OMNIROUTE_EMBEDDING_MODEL'),
          }),
        }).getProvider(),
    },
    {
      provide: AI_COMPLETION_PORT,
      inject: [CHAT_MODEL_PORT, TOOL_GATEWAY_PORT],
      useFactory: (model: ChatModelPort, tools: ToolGatewayPort) =>
        new ToolCallingAgent(
          model,
          tools,
          new NestLoggerAdapter(ToolCallingAgent.name),
        ),
    },
  ],
  exports: [AI_COMPLETION_PORT, TOOL_GATEWAY_PORT],
})
export class McpClientModule {}
