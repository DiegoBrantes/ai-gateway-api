import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayService } from '../services/gateway.service';
import { embeddingsRequestSchema } from '../schemas';

export class EmbeddingsController {
  constructor(private readonly gateway: GatewayService) {}

  create = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const input = embeddingsRequestSchema.parse(request.body);
    const response = await this.gateway.embeddings(
      input,
      request.principal ?? 'anonymous',
    );
    reply.send(response);
  };
}
