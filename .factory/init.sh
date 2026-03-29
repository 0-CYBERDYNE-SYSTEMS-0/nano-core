#!/usr/bin/env bash
set -euo pipefail

echo "[init] Checking Node.js environment..."
node --version

echo "[init] Installing dependencies..."
npm install --prefer-offline 2>&1 | tail -5

echo "[init] Build check..."
npx tsc --noEmit 2>&1 | tail -3 || true

echo "[init] Environment ready."
