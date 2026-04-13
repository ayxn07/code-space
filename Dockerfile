# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# CI-friendly env
ENV HUSKY=0
ENV CI=true

# Use pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Ensure git is available for build and runtime scripts
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# Accept (optional) build-time public URL for Remix/Vite (Coolify can pass it)
ARG VITE_PUBLIC_APP_URL
ENV VITE_PUBLIC_APP_URL=${VITE_PUBLIC_APP_URL}

# Install deps efficiently
COPY package.json pnpm-lock.yaml* ./
RUN pnpm fetch

# Copy source and build
COPY . .
# install with dev deps (needed to build)
RUN pnpm install --offline --frozen-lockfile

# Build the Remix app (SSR + client)
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

# ---- production dependencies stage ----
FROM build AS prod-deps

# Keep only production deps for runtime
RUN pnpm prune --prod --ignore-scripts


# ---- production stage ----
FROM node:22-bookworm-slim AS hackcortex-production
WORKDIR /app

ENV NODE_ENV=production
# Railway injects PORT at runtime; default to 5173 for local Docker usage
ENV PORT=${PORT:-5173}
ENV HOST=0.0.0.0

# Non-sensitive build arguments
ARG VITE_LOG_LEVEL=debug
ARG DEFAULT_NUM_CTX

# Set non-sensitive environment variables
ENV WRANGLER_SEND_METRICS=false \
    VITE_LOG_LEVEL=${VITE_LOG_LEVEL} \
    DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX} \
    RUNNING_IN_DOCKER=true \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Note: API keys should be provided at runtime via docker run -e or docker-compose
# Example: docker run -e OPENAI_API_KEY=your_key_here ...

# Install curl for healthchecks, ca-certificates for TLS, and pnpm for running scripts
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
  && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy pruned production deps (wrangler is now a regular dep so it survives prune)
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/package.json /app/package.json
# Copy built output
COPY --from=build /app/build /app/build
# Copy runtime files needed by Wrangler for SSR function handling
COPY --from=build /app/bindings.sh /app/bindings.sh
COPY --from=build /app/functions /app/functions
COPY --from=build /app/app/lib/auth /app/app/lib/auth
COPY --from=build /app/worker-configuration.d.ts /app/worker-configuration.d.ts
COPY --from=build /app/wrangler.toml /app/wrangler.toml

# Pre-configure wrangler to disable metrics
RUN mkdir -p /root/.config/.wrangler && \
    echo '{"enabled":false}' > /root/.config/.wrangler/metrics.json

# Make bindings script executable
RUN chmod +x /app/bindings.sh

EXPOSE ${PORT}

# Healthcheck for deployment platforms (uses $PORT for flexibility)
# /health bypasses auth middleware so the probe always gets a 200
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD curl -fsS http://localhost:${PORT}/health || exit 1

# Start using dockerstart script with Wrangler
CMD ["pnpm", "run", "dockerstart"]


# ---- development stage ----
FROM build AS development

# Non-sensitive development arguments
ARG VITE_LOG_LEVEL=debug
ARG DEFAULT_NUM_CTX

# Set non-sensitive environment variables for development
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL} \
    DEFAULT_NUM_CTX=${DEFAULT_NUM_CTX} \
    RUNNING_IN_DOCKER=true

# Note: API keys should be provided at runtime via docker run -e or docker-compose
# Example: docker run -e OPENAI_API_KEY=your_key_here ...

RUN mkdir -p /app/run
CMD ["pnpm", "run", "dev", "--host"]
