# MAIS CAR — production Dockerfile (cloud migration, 2026-09-15).
# One image, one process model: Node backend + Remotion (headless
# Chromium) + FFmpeg + fonts + Prisma client. Runs on a single small
# Linux VPS behind docker-compose.cloud.yml — no Kubernetes, no
# microservices.

# ---------- Build stage ----------
FROM node:22-bookworm-slim AS build
ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

# Native deps needed to build sharp + node-canvas + prisma-client
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    ca-certificates git openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Copy manifests first for docker layer cache
COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
# Install the workspace (backend + frontend) — root package-lock.json.
# --include=dev because build needs typescript/tsx/prisma; --workspaces installs all
RUN npm ci --include=dev --no-audit --no-fund --workspaces --include-workspace-root

COPY . .
# Skip tsc typecheck — runtime is tsx (transpile-only). Prisma still generated.
RUN cd packages/backend && npx prisma generate

# ---------- Runtime stage ----------
FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    # Remotion picks this up: point it at the system chromium.
    REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium \
    # Timezone for the scheduler (America/Recife is UTC-3 all year, no DST).
    TZ=America/Recife

# Runtime deps only: chromium (Remotion), ffmpeg (encoder), fonts (TTF for
# TalkingHost + KineticText), tini (PID 1), ca-certs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ffmpeg tini ca-certificates openssl tzdata \
    fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
    fontconfig \
    # Chromium runtime shared libs (already pulled by the chromium pkg, listed here for the audit trail).
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app
# Copy the full workspace so tsx can find src/*, remotion/*, node_modules, prisma, assets
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages

# Non-root user (chromium needs --no-sandbox anyway; this is defense in depth).
RUN useradd -r -u 1001 -g root -d /app -m maiscar \
 && chown -R maiscar:root /app
USER maiscar


EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "packages/backend/src/server.ts"]
