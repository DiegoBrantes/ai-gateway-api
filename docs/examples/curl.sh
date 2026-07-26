#!/usr/bin/env bash
# AI Gateway API — cURL examples. Default API key matches .env.example.
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"
KEY="${API_KEY:-dev-key-please-change}"

# 1) Health & readiness (public)
curl -s "$BASE/health"
curl -s "$BASE/ready"

# 2) Chat completion
curl -s -X POST "$BASE/v1/chat" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"messages":[{"role":"user","content":"Explain a reverse proxy in one sentence."}]}'

# 3) Streaming chat (SSE) — events: provider, delta, done, end
curl -N -X POST "$BASE/v1/chat/stream" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"messages":[{"role":"user","content":"Write a haiku about the sea."}]}'

# 4) Embeddings
curl -s -X POST "$BASE/v1/embeddings" \
  -H "content-type: application/json" \
  -H "x-api-key: $KEY" \
  -d '{"input":["hello","world"]}'

# 5) Exchange an API key for a JWT, then call with a Bearer token
TOKEN=$(curl -s -X POST "$BASE/auth/token" \
  -H "content-type: application/json" \
  -d "{\"apiKey\":\"$KEY\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -s -X POST "$BASE/v1/chat" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"messages":[{"role":"user","content":"hi via jwt"}]}'

# 6) Metadata
curl -s "$BASE/v1/providers" -H "x-api-key: $KEY"
curl -s "$BASE/v1/models"    -H "x-api-key: $KEY"
curl -s "$BASE/v1/usage"     -H "x-api-key: $KEY"
