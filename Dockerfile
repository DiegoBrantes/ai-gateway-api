# ── Build stage ──────────────────────────────────────────────
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini: a tiny init that reaps zombies and forwards signals to Node (PID 1),
# so SIGTERM reaches the graceful-shutdown handler in server.ts.
RUN apk add --no-cache tini

# Install only production dependencies.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as the built-in unprivileged user.
USER node
EXPOSE 3000

# Readiness is richer, but liveness is the right signal for a container probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
