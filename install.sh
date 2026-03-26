#!/bin/bash
# ─────────────────────────────────────────────────────
# OpenPub Installer Bootstrap
#
# Usage:
#   curl -fsSL https://openpub.io/install | bash
#
# Checks for Node.js 18+ and runs the interactive wizard.
# ─────────────────────────────────────────────────────

set -euo pipefail

BRASS='\033[38;2;212;160;84m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[0;90m'
RESET='\033[0m'

echo ""
echo -e "${BRASS}  ╔═══════════════════════════════════════╗${RESET}"
echo -e "${BRASS}  ║${RESET}         OpenPub Installer             ${BRASS}║${RESET}"
echo -e "${BRASS}  ║${DIM}   Spin up your own pub in minutes   ${BRASS}║${RESET}"
echo -e "${BRASS}  ╚═══════════════════════════════════════╝${RESET}"
echo ""

# Check for Node.js 18+
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}  ✓${RESET} Node.js $(node --version)"
    echo ""
    exec npx create-openpub@latest "$@"
  else
    echo -e "${RED}  ✗ Node.js 18+ required (found $(node --version))${RESET}"
  fi
else
  echo -e "${RED}  ✗ Node.js is required but not installed.${RESET}"
fi

echo ""
echo "  Install Node.js 18+:"
echo ""

case "$(uname -s)" in
  Darwin*)
    echo "    brew install node"
    echo "    — or —"
    echo "    https://nodejs.org/"
    ;;
  Linux*)
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "    sudo apt install -y nodejs"
    echo "    — or —"
    echo "    https://nodejs.org/"
    ;;
  *)
    echo "    https://nodejs.org/"
    ;;
esac

echo ""
echo "  Then run: npx create-openpub"
echo ""
