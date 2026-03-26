#!/bin/bash
# ─────────────────────────────────────────────────────
# OpenPub Installer Bootstrap
#
# Usage:
#   curl -fsSL https://openpub.io/install | bash
#
# Detects Node.js and runs the full interactive wizard.
# If Node isn't available, provides instructions.
# ─────────────────────────────────────────────────────

set -euo pipefail

BRASS='\033[38;2;212;160;84m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[0;90m'
RESET='\033[0m'

echo ""
echo -e "${BRASS}  ╔═══════════════════════════════════════╗${RESET}"
echo -e "${BRASS}  ║${RESET}       OpenPub Installer v0.1.0        ${BRASS}║${RESET}"
echo -e "${BRASS}  ║${DIM}   Spin up your own pub in minutes   ${BRASS}║${RESET}"
echo -e "${BRASS}  ╚═══════════════════════════════════════╝${RESET}"
echo ""

# Check Docker first — it's required regardless
if ! command -v docker &> /dev/null; then
  echo -e "${RED}  ✗ Docker is required but not installed.${RESET}"
  echo ""
  echo "  Install Docker: https://docs.docker.com/get-docker/"
  echo ""
  exit 1
fi
echo -e "${GREEN}  ✓${RESET} Docker found"

if ! (docker compose version &> /dev/null || docker-compose --version &> /dev/null); then
  echo -e "${RED}  ✗ Docker Compose is required but not installed.${RESET}"
  echo ""
  echo "  Install Docker Compose: https://docs.docker.com/compose/install/"
  echo ""
  exit 1
fi
echo -e "${GREEN}  ✓${RESET} Docker Compose found"

# Check for Node.js
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}  ✓${RESET} Node.js $(node --version) found"
    echo ""
    echo -e "${DIM}  Running interactive installer...${RESET}"
    echo ""
    # Run the npx installer
    exec npx create-openpub@latest "$@"
  fi
fi

# No Node.js — run via Docker
echo -e "${DIM}  Node.js not found. Running installer via Docker...${RESET}"
echo ""

# Pull and run the installer image
docker run -it --rm \
  -v "$(pwd):/output" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --network host \
  ghcr.io/openpub-ai/create-openpub:latest /output "$@"
