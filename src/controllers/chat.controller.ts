import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayService } from '../services/gateway.service';
import { chatRequestSchema } from '../schemas';
import { sseFrame } from '../utils/sse';

/**
 * HTTP adapter for chat. Validates input, delegates all logic to the
 * GatewayService, and — for the streaming variant — bridges the
 * provider-agnostic event stream onto an SSE response.
 */
export class ChatController {
  constructor(private readonly gateway: GatewayService) {}

  chat = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const input = chatRequestSchema.parse(request.body);
    const response = await this.gateway.chat(input, request.principal ?? 'anonymous');
    reply.send(response);
  };

  stream = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Validate BEFORE hijacking so a bad body still gets the normal JSON
    // error response from the global handler.
    const input = chatRequestSchema.parse(request.body);

    // Take ownership of the socket: Fastify will not try to send a reply,
    // which is the correct contract when writing to `reply.raw` directly.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    try {
      for await (const event of this.gateway.chatStream(
        input,
        request.principal ?? 'anonymous',
      )) {
        if (event.type === 'delta') {
          reply.raw.write(
            sseFrame('delta', { content: event.delta, provider: event.provider }),
          );
        } else {
          reply.raw.write(
            sseFrame('done', {
              provider: event.provider,
              model: event.model,
              usage: event.usage,
            }),
          );
        }
      }
    } catch (error) {
      reply.raw.write(
        sseFrame('error', {
          message: error instanceof Error ? error.message : 'stream failed',
        }),
      );
    } finally {
      reply.raw.write('event: end\ndata: [DONE]\n\n');
      reply.raw.end();
    }
  };
}
