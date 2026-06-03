#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-brainsync}"
BRANCH="${BRANCH:-feature/home-and-pve}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

echo "==> Updating ${APP_NAME} from origin/${BRANCH}"

if ! command -v git >/dev/null 2>&1; then
  echo "git command not found" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm command not found" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 command not found" >&2
  exit 1
fi

git fetch origin
git reset --hard "origin/${BRANCH}"

echo "==> Installing production dependencies"
rm -rf node_modules
npm ci --omit=dev --no-audit --no-fund

echo "==> Restarting PM2 app: ${APP_NAME}"
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start "npm start" --name "${APP_NAME}"
pm2 save

echo "==> Health check: ${HEALTH_URL}"
for attempt in 1 2 3 4 5; do
  if curl -fsS "${HEALTH_URL}"; then
    echo
    echo "==> Deploy complete"
    exit 0
  fi
  echo "Health check failed, retry ${attempt}/5..."
  sleep 2
done

echo "Health check failed after retries. Recent PM2 logs:" >&2
pm2 logs "${APP_NAME}" --lines 50 --nostream >&2 || true
exit 1
