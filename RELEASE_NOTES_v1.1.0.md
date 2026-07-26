# AI Gateway API v1.1.0 — Security, Streaming and Reliability

> Nota: git não está disponível neste ambiente, então esta release **não** foi
> criada/publicada no GitHub. Estas notas ficam prontas para acompanhar a tag
> `v1.1.0` quando for publicada.

Rodada de endurecimento que corrige os achados da auditoria técnica: elimina falhas
de credibilidade, fecha lacunas de segurança, adiciona resiliência real ao streaming
e eleva a cobertura de testes das partes críticas — sem transformar o gateway
compacto em outra coisa.

## Added
- **Readiness** `GET /ready` (checa providers + cache), separado do liveness `/health`.
- **`GET /openapi.json`** sempre servido; **Swagger UI** (`/docs`) atrás de `ENABLE_SWAGGER_UI` (desligado por padrão em produção).
- **Capacidades por modelo** em `GET /v1/models`; `GET /v1/providers` marca o provedor `mock`.
- **Failover de streaming antes do primeiro token** + evento SSE `provider` + frames `error` estruturados.
- **Cancelamento no disconnect** do cliente (aborta o upstream).
- **Isolamento de cache por chamador** (`CACHE_SCOPE`, default `principal`) e **cache em memória com limite/LRU** (`MEMORY_CACHE_MAX_ENTRIES`).
- **Comparação constant-time** de API keys (`crypto.timingSafeEqual`/SHA-256).
- **Proteção de dashboard/métricas** em produção (`DASHBOARD_PUBLIC`, `ADMIN_API_KEY`).
- **Dashboard reescrito**: status real, loading/empty/error, mobile, acessibilidade, escape de dados, "última atualização", pausar/atualizar, aviso de métricas em memória.
- **Exemplos** em `docs/examples/` (curl, JS, TS, Python) e **screenshots** em `docs/screenshots/`.
- CI: `permissions` mínimas, **Dependabot** e **CodeQL**.

## Changed
- **Custo honesto**: modelos sem preço → `pricingKnown:false` + custo `null` (nunca `0` enganoso); acumulação em **micro-dólares** inteiros.
- **OpenAPI** documenta response/error schemas, exemplos e `bearerAuth`.
- **Documentação alinhada ao código**: seção *Production Readiness*, contagem de testes corrigida (124), claims "production-ready"/failover de streaming qualificados.

## Fixed
- **Parser SSE aceita `\r\n\r\n`** (não só `\n\n`) — descoberto testando contra a **API real do Gemini**, que usa CRLF; antes o streaming real do Gemini não emitia nenhum `delta`. + testes de regressão.
- **Catálogo de modelos do Gemini atualizado** para aliases estáveis (`gemini-flash-latest`, `gemini-pro-latest`, `gemini-embedding-001`); os `gemini-1.5-*`/`text-embedding-004` davam 404 na API real. Pricing ajustado.
- **Custo precifica snapshots datados por família** — a OpenAI responde um pedido de `gpt-4o-mini` com `gpt-4o-mini-2024-07-18`; `priceFor` agora casa pelo prefixo de família, então respostas reais ficam `pricingKnown:true`. Descoberto com a API real da OpenAI.
- `GET /v1/models` não copia mais as capacidades do provedor para todo modelo (modelos de embedding não anunciam `chat`/`vision`).
- `RedisCache.get` não derruba mais a requisição com JSON corrompido (descarta e retorna miss).
- Mock **não responde silenciosamente em produção** (boot falha sem `ALLOW_MOCK_PROVIDER=true`).

## Security
- `npm audit`: de **8** (2 críticas, 2 altas) para **0** — via upgrades + `overrides`; CI `security-audit` agora passa.
- Tratado um CVE alto publicado durante a rodada (`brace-expansion`/`minimatch` DoS, transitivo via `@fastify/static`/eslint) com override de `brace-expansion@^5.0.8`; audit de volta a **0** sem quebrar o lint.
- Removida a capacidade `vision` falsa da metadata de modelos.

## Verificado contra provedores reais
- **OpenAI** (`gpt-4o-mini`): chat + streaming (10 deltas) reais, custo precificado. Embeddings → 403 limpo (projeto da chave sem acesso ao modelo).
- **Gemini** (`gemini-flash-latest`/`gemini-embedding-001`): chat + streaming + embeddings, todos precificados.
- **Anthropic** (`claude-3-5-haiku-latest`): chave válida sem saldo → 400 de billing; confirmou o tratamento de erro real (envelope JSON + `event: error`/`event: end` no SSE, sem failover em 4xx).
- Docker ainda não construído (ambiente sem Docker).

## Known limitations
- Métricas **em memória** (zeram no restart; não somam entre instâncias).
- Sem **persistência** de histórico (sem banco).
- Custo é **estimativa**, não faturamento.
- Failover de streaming vale **só antes do primeiro token**.
- **Docker não foi construído** nesta rodada (indisponível no ambiente); Dockerfile/compose revisados estaticamente.

## Upgrade notes
- Novas variáveis (todas com defaults seguros): `ADMIN_API_KEY`, `ALLOW_MOCK_PROVIDER`, `DASHBOARD_PUBLIC`, `ENABLE_SWAGGER_UI`, `CACHE_SCOPE`, `MEMORY_CACHE_MAX_ENTRIES`. Ver `.env.example`.
- **Breaking (produção)**: sem provedor real e sem `ALLOW_MOCK_PROVIDER=true`, o boot falha; dashboard/métricas passam a exigir auth por padrão.
