#!/usr/bin/env bash
# MAIS CAR — one-shot bootstrap for a fresh Hetzner Cloud CX22 (2026-09-15).
# Copies compose files, installs Docker if missing, pulls the image from
# GHCR, and starts the stack. Run ONCE on the VPS as root right after
# `hcloud server create --type cx22 --image debian-12 ...`. CI takes
# over from the second deploy onwards.
#
# Usage:
#   scp platform/docker-compose.cloud.yml platform/Caddyfile \
#       platform/.env.production platform/scripts/deploy.sh \
#       root@<vps-ip>:/root/
#   ssh root@<vps-ip> "bash /root/deploy.sh"

set -euo pipefail

APP_DIR="/srv/maiscar"
COMPOSE_FILE="docker-compose.cloud.yml"

# 1. Docker + compose plugin (Debian 12 / Ubuntu 24.04)
if ! command -v docker >/dev/null 2>&1; then
    echo "[bootstrap] installing docker..."
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

# 2. Non-root user for the app (SSH lands here for CI, not root).
if ! id maiscar >/dev/null 2>&1; then
    useradd -m -s /bin/bash maiscar
    usermod -aG docker maiscar
fi

# 3. Layout /srv/maiscar/
mkdir -p "$APP_DIR"
chown -R maiscar:maiscar "$APP_DIR"
mv -n docker-compose.cloud.yml Caddyfile .env.production "$APP_DIR/" 2>/dev/null || true
cd "$APP_DIR"

# 4. Login to GHCR with a read-only PAT (env var GH_PULL_PAT).
if [ -n "${GH_PULL_PAT:-}" ]; then
    echo "$GH_PULL_PAT" | docker login ghcr.io -u "${GITHUB_OWNER:-maiscarconsult}" --password-stdin
fi

# 5. Pull + start.
docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 180

# 6. First-time DB migrate.
docker compose -f "$COMPOSE_FILE" exec -T backend node packages/backend/dist/scripts/prismaMigrateDeploy.js || true

# 7. Health.
sleep 5
curl -sf http://127.0.0.1:4000/health && echo "[bootstrap] backend healthy"
docker compose -f "$COMPOSE_FILE" exec -T backend node packages/backend/dist/scripts/cloud-smoke-test.js
echo "[bootstrap] done."
