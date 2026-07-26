import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayService } from '../services/gateway.service';
import { chatRequestSchema } from '../schemas';
import { AppError } from '../utils/errors';
import { sseFrame } from '../utils/sse';

/**
 * HTTP adapter for chat. Validates input, delegates all logic to the
 * GatewayService, and — for the streaming variant — bridges the
 * provider-agnostic event stream onto an SSE response and propagates client
 * disconnects upstream so we stop generating (and paying) once the caller
 * goes away.
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

    // Cancel upstream work when the client disconnects mid-stream.
    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    request.raw.once('close', onClose);

    try {
      for await (const event of this.gateway.chatStream(
        input,
        request.principal ?? 'anonymous',
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        if (event.type === 'open') {
          reply.raw.write(
            sseFrame('provider', { provider: event.provider, model: event.model }),
          );
        } else if (event.type === 'delta') {
          reply.raw.write(
            sseFrame('delta', { content: event.delta, provider: event.provider }),
          );
        } else {
          reply.raw.write(
            sseFrame('done', {
              provider: event.provider,
              model: event.model,
              usage: event.usage,
              cost: event.cost,
              attempts: event.attempts,
            }),
          );
        }
      }
    } catch (error) {
      // A client that already disconnected doesn't need (and can't receive) an
      // error frame — the abort is expected, not a failure.
      if (!controller.signal.aborted) {
        reply.raw.write(
          sseFrame('error', {
            code: error instanceof AppError ? error.code : 'stream_error',
            message: error instanceof Error ? error.message : 'stream failed',
            requestId: request.id,
          }),
        );
      }
    } finally {
      request.raw.removeListener('close', onClose);
      if (!reply.raw.writableEnded) {
        reply.raw.write('event: end\ndata: [DONE]\n\n');
        reply.raw.end();
      }
    }
  };
}
