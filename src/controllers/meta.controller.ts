import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProviderRegistry } from '../providers/registry';
import type { MetricsService } from '../services/metrics.service';
import type { ModelInfo, ProviderHealth } from '../types';

/**
 * Read-only metadata endpoints: provider inventory, model catalogue and
 * per-caller usage analytics. No provider calls, no side effects.
 */
export class MetaController {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly metrics: MetricsService,
  ) {}

  providers = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const providers: ProviderHealth[] = this.registry.all().map((provider) => ({
      name: provider.name,
      configured: provider.isConfigured(),
      mock: provider.isMock,
      models: provider.listModels(),
    }));
    reply.send({ providers });
  };

  models = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const models: ModelInfo[] = this.registry.all().flatMap((provider) =>
      provider.listModelInfos().map((model) => ({
        id: model.id,
        provider: provider.name,
        capabilities: [...model.capabilities],
      })),
    );
    reply.send({ models });
  };

  usage = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // A caller sees only their own usage; the global view lives on the dashboard.
    reply.send(this.metrics.forApiKey(request.principal ?? 'anonymous'));
  };
}
