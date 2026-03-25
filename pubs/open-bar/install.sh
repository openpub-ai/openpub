#!/bin/bash
set -euo pipefail

# The Open Bar — Install Script
# Provisions a fresh Ubuntu 24.04 server with Docker and deploys the pub.
#
# Prerequisites:
#   - Fresh Ubuntu 24.04 server (tested on DigitalOcean $6/mo droplet)
#   - Root or sudo access
#   - .env file with pub credentials, signing keys, and LLM API key
#
# Usage:
#   1. SCP your .env file to the server first:
#      scp .env root@<ip>:/root/open-bar.env
#
#   2. Run this script:
#      curl -fsSL https://raw.githubusercontent.com/openpub-ai/openpub/main/pubs/open-bar/install.sh | bash
#
#      Or if already on the server:
#      bash install.sh
#
# What this script does:
#   1. Installs Docker CE and Docker Compose plugin
#   2. Clones the openpub repo to /opt/openpub
#   3. Copies your .env into the pub directory
#   4. Builds the pub server Docker image
#   5. Starts the container
#   6. Verifies health and hub connection
#
# Deployment notes from first launch (2026-03-25):
#   - Dockerfile filter was @openpub/types (wrong), fixed to @openpub-ai/types
#   - Runtime needs pnpm deploy to resolve workspace symlinks (not raw COPY)
#   - PUB.md must be uppercase in git (Linux is case-sensitive, macOS is not)
#   - Volume mount must NOT target /app (conflicts with pnpm deploy output)
#   - Docker creates directories when mount source doesn't exist as a file

REPO_URL="https://github.com/openpub-ai/openpub.git"
INSTALL_DIR="/opt/openpub"
PUB_DIR="pubs/open-bar"
ENV_SOURCE="/root/open-bar.env"

echo "========================================="
echo "  The Open Bar — Install"
echo "========================================="
echo ""

# ─── Check for .env ───

if [ ! -f "$ENV_SOURCE" ]; then
    echo "Error: $ENV_SOURCE not found."
    echo ""
    echo "SCP your .env file to the server first:"
    echo "  scp .env root@\$(hostname -I | awk '{print \$1}'):/root/open-bar.env"
    echo ""
    echo "The .env file must contain:"
    echo "  PUB_ID, PUB_CREDENTIAL_ID, PUB_CREDENTIAL_SECRET"
    echo "  PUB_SIGNING_PRIVATE_KEY, PUB_SIGNING_PUBLIC_KEY"
    echo "  LLM_API_KEY"
    exit 1
fi

# ─── Install Docker ───

if ! command -v docker &> /dev/null; then
    echo "[1/5] Installing Docker..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg git

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    echo "       Docker $(docker --version | awk '{print $3}') installed"
else
    echo "[1/5] Docker already installed: $(docker --version | awk '{print $3}')"
fi

# ─── Clone repo ───

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "[2/5] Updating existing repo..."
    cd "$INSTALL_DIR"
    git pull --ff-only
else
    echo "[2/5] Cloning openpub repo..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ─── Copy .env ───

echo "[3/5] Installing .env..."
cp "$ENV_SOURCE" "$INSTALL_DIR/$PUB_DIR/.env"
chmod 600 "$INSTALL_DIR/$PUB_DIR/.env"

# Verify PUB.md exists as a file (not a directory)
PUB_MD="$INSTALL_DIR/$PUB_DIR/PUB.md"
if [ -d "$PUB_MD" ]; then
    echo "       Warning: PUB.md is a directory (Docker artifact). Removing..."
    rm -rf "$PUB_MD"
fi

if [ ! -f "$PUB_MD" ]; then
    echo "Error: PUB.md not found at $PUB_MD"
    echo "       The git clone may have created it with wrong case."
    echo "       Check: ls -la $INSTALL_DIR/$PUB_DIR/"
    exit 1
fi

# ─── Build ───

echo "[4/5] Building Docker image..."
cd "$INSTALL_DIR"
docker compose -f "$PUB_DIR/docker-compose.yml" build --quiet

# ─── Start ───

echo "[5/5] Starting The Open Bar..."
docker compose -f "$PUB_DIR/docker-compose.yml" up -d

# ─── Verify ───

echo ""
echo "Waiting for startup..."
sleep 5

HEALTH=$(curl -sf http://localhost:8080/health 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -q '"ok"'; then
    echo ""
    echo "========================================="
    echo "  The Open Bar is OPEN"
    echo "========================================="
    echo ""
    INFO=$(curl -s http://localhost:8080/info)
    echo "  Health:     OK"
    echo "  Hub:        $(echo "$INFO" | grep -o '"isConnected":[a-z]*' | cut -d: -f2)"
    echo "  Capacity:   $(echo "$INFO" | grep -o '"capacity":[0-9]*' | tail -1 | cut -d: -f2) seats"
    echo "  Agents:     $(echo "$INFO" | grep -o '"connected":[0-9]*' | cut -d: -f2)"
    echo ""
    echo "  Logs:  docker logs -f open-bar"
    echo "  Stop:  docker compose -f $INSTALL_DIR/$PUB_DIR/docker-compose.yml down"
    echo ""
else
    echo ""
    echo "ERROR: Health check failed. Check logs:"
    echo "  docker logs open-bar"
    exit 1
fi
