# cora-backend — hardened multi-stage build.
# Plain CommonJS Node (no transpile). better-sqlite3 native module.
# Docker context must be the monorepo root (fly.toml sets dockerfile path).

# ---- builder ----
FROM node:22-bookworm-slim AS builder
# python3 + build-essential: only used if better-sqlite3 has no prebuilt for
# this platform. Discarded with the builder stage either way.
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Copy SDK first so the file:../sdk link resolves during npm ci
COPY sdk/package.json ./sdk/package.json
COPY sdk/dist ./sdk/dist
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/src ./src

# ---- runner ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production PORT=4200
WORKDIR /app/backend
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/sdk /app/sdk
RUN mkdir -p /data
EXPOSE 4200
CMD ["node", "src/index.js"]
