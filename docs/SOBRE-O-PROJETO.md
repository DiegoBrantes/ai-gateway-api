# Sobre o projeto — guia para entrevista

Um resumo do que é o **AI Gateway API**, por que ele existe e como explicá-lo com
segurança para um recrutador ou desenvolvedor. Escrito em português; o código e a
documentação técnica estão em inglês (padrão de mercado / open source).

---

## 1. O pitch de 30 segundos

> "É um **gateway unificado de IA**: uma única API que fala com OpenAI, Google
> Gemini e Anthropic ao mesmo tempo. A aplicação cliente usa **um só formato de
> requisição**, e o gateway cuida das diferenças de cada provedor. Se um provedor
> cai, ele **troca automaticamente** para outro (fallback). Ele faz **streaming**
> token a token, **conta os tokens** e **estima o custo em dólar** de cada
> chamada, tem **autenticação**, **rate limiting**, **cache** e um **dashboard**
> de consumo. Foi construído em TypeScript com Fastify, seguindo Clean
> Architecture, com testes automatizados, Docker e CI."

## 2. Que problema ele resolve

Hoje quase nenhum produto sério aposta em um único provedor de IA:

- **Preço**: cada provedor cobra diferente por token; você quer poder escolher o
  mais barato para cada tarefa.
- **Disponibilidade**: provedores têm instabilidade e limites de uso. Se a OpenAI
  cair, você quer continuar funcionando via Anthropic ou Gemini.
- **Lock-in**: cada SDK tem um formato diferente. Trocar de provedor normalmente
  significa reescrever código.

O gateway resolve isso colocando **uma camada de abstração** na frente dos três.
A sua aplicação nunca importa o SDK da OpenAI — ela fala com o gateway, e o
gateway decide qual provedor usar, com fallback, retry e timeout.

## 3. Arquitetura — a decisão central

O coração do projeto é uma **interface `Provider`** (`src/providers/types.ts`).
Cada provedor (OpenAI, Gemini, Anthropic, e um Mock para testes) é um **adapter**
que implementa essa interface. O resto da aplicação **depende só da interface,
nunca de um provedor concreto**.

Isso é o **Dependency Inversion Principle** (o "D" do SOLID) na prática, e é
exatamente o que torna possível:

- **Trocar de provedor** sem mudar nada no resto do código.
- **Adicionar um novo provedor** implementando uma única interface — nenhuma outra
  parte do sistema precisa saber.
- **Testar sem rede**: existe um `MockProvider` que responde de forma
  determinística. Toda a suíte de testes roda sem nenhuma API key e sem internet.

```
Cliente ──▶ Controller ──▶ GatewayService ──▶ Provider (interface)
                                │                   ├── OpenAIProvider
                                │                   ├── GeminiProvider
   (fallback / retry / timeout /│                   ├── AnthropicProvider
    cache / métricas / custo)   │                   └── MockProvider
```

O `GatewayService` é o orquestrador: ele monta a **cadeia de fallback**, tenta
cada provedor com **retry (backoff exponencial + jitter)** e **timeout**, consulta
o **cache** para chamadas idênticas, calcula **uso de tokens + custo** e registra
**métricas**. Os controllers são finos: só validam a entrada (com **Zod**) e
delegam. Serviços recebem suas dependências pelo construtor (**injeção de
dependência**), então os testes injetam versões falsas sem "mockar" módulos.

## 4. Como cada requisito de qualidade aparece no código

| Conceito                            | Onde está                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **SOLID / Clean Architecture**      | Interface `Provider`, adapters, serviços com DI, controllers finos.                                                                    |
| **DRY / KISS**                      | Utilitários compartilhados (`retry`, `timeout`, parser de SSE), sem repetição entre adapters.                                          |
| **Tratamento de erros consistente** | Erros tipados (`AppError` e subclasses) + um único error handler global que serializa tudo num envelope JSON padronizado.              |
| **Validação de entrada**            | Schemas Zod em `src/schemas`.                                                                                                          |
| **Validação de ambiente**           | `src/config/env.ts` valida o `.env` com Zod e **falha no boot** se algo estiver errado (fail-fast).                                    |
| **Tipagem completa**                | TypeScript em modo `strict`, com `noUncheckedIndexedAccess`.                                                                           |
| **Testes**                          | 124 testes (Vitest, ~95% linhas): adaptadores reais (fetch mockado), parser SSE, failover de streaming, custo, cache (TTL/LRU/isolamento), rate limit, guards de produção/mock, `/ready`, contrato OpenAPI e a API HTTP inteira. |
| **Observabilidade**                 | Logs estruturados (pino), métricas de uso, dashboard ao vivo.                                                                          |
| **Ops**                             | Docker multi-stage (roda como usuário não-root, com HEALTHCHECK), docker-compose com Redis, GitHub Actions.                            |

## 5. Decisões técnicas que valem explicar

- **Fastify em vez de Express**: mais rápido, com validação de schema e geração de
  OpenAPI nativas, e tipagem melhor.
- **Sem SDKs de provedor**: os adapters chamam a API HTTP de cada provedor
  diretamente com o `fetch` nativo do Node. Isso deixa a árvore de dependências
  pequena e o caminho de streaming totalmente sob controle.
- **Cache com interface + duas implementações** (Redis e memória): em
  desenvolvimento roda sem Redis; em produção multi-instância usa Redis, sem mudar
  o código que consome o cache.
- **Streaming com SSE + `reply.hijack()`**: ao escrever direto no socket, o
  contrato correto do Fastify é assumir o controle da resposta com `hijack()`,
  para o framework não tentar enviar uma resposta duplicada.
- **Contagem de tokens**: quando o provedor devolve o uso real, usamos ele; quando
  não devolve (ex.: streaming), usamos uma estimativa calibrada. O custo vem de
  uma tabela de preços por modelo, isolada num único arquivo fácil de atualizar.

## 6. Se cair no meu colo em produção, o que falta?

Ser honesto sobre limites passa credibilidade. O roadmap no README já lista:

- Endpoints extras (visão, OCR, transcrição, tradução, geração de imagem,
  moderação) — a base já suporta, é estender.
- Limites de orçamento por chave e métricas persistidas (Postgres/ClickHouse) —
  hoje as métricas são em memória, por instância.
- Cache semântico (por embeddings) e roteamento por latência/custo.

## 7. Perguntas de entrevista prováveis (e boas respostas)

**"Como você adicionaria um quarto provedor, tipo Mistral?"**
Crio `src/providers/mistral/index.ts` implementando a interface `Provider`,
registro ele no `registry.ts`, adiciono os preços na tabela de pricing. Nenhum
outro arquivo muda — é o ponto da abstração.

**"Como funciona o fallback?"**
O `GatewayService` monta uma cadeia ordenada (provedor explícito → default →
fallbacks configurados). Ele tenta o primeiro com retry/timeout; em falhas
transitórias (5xx/429) passa para o próximo e registra a tentativa. Erros de
cliente (4xx, ex.: input inválido) **não** fazem fallback — não adianta tentar
outro provedor com um pedido inválido.

**"Por que não usou os SDKs oficiais?"**
Para controlar o streaming e manter a dependência mínima. Cada adapter mapeia o
formato nativo do provedor para o meu modelo de domínio, então a diferença de
schema entre OpenAI/Gemini/Anthropic fica isolada num único arquivo por provedor.

**"Como você testa sem gastar dinheiro com as APIs?"**
Um `MockProvider` determinístico é habilitado automaticamente quando não há
credenciais. A suíte inteira roda sem rede — inclusive os testes HTTP, via o
`inject` do Fastify.

**"E se dois pods incrementarem o rate limit ao mesmo tempo?"**
Com Redis o contador usa `INCR` atômico, então o limite é correto mesmo com várias
instâncias. Em memória (uma instância) também é correto.

**"O que acontece se um provedor trava no meio do streaming?"**
Cada requisição tem timeout via `AbortController`. O failover entre provedores no
streaming acontece **antes do primeiro token**: se o provedor escolhido falhar ao
abrir o stream, o gateway tenta o próximo. Depois que o primeiro `delta` já foi
enviado, não trocamos de provedor (misturaria respostas) — o erro é capturado e
enviado como um evento `error` no próprio SSE antes de fechar. Se o cliente
desconecta, o `AbortController` cancela a chamada upstream.

## 8. Como rodar na hora de demonstrar

```bash
npm install
npm run dev          # sobe em http://localhost:3000 (modo mock, sem API key)
```

Depois abra:

- `http://localhost:3000/docs` — Swagger UI interativo
- `http://localhost:3000/dashboard` — dashboard de consumo ao vivo

E rode `npm test` na frente do recrutador — **124 testes verdes** em ~4s passam muita
confiança.
