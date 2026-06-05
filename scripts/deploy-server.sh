#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-brainsync}"
BRANCH="${BRANCH:-}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "${name} command not found" >&2
    exit 1
  fi
}

require_command git
require_command npm
require_command pm2
require_command curl

if [ ! -f package.json ] || [ ! -f ecosystem.config.cjs ]; then
  echo "Please run this script from the BrainSync project root." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit, stash, or remove local changes before deploying." >&2
  git status --short >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
target_branch="${BRANCH:-${current_branch}}"

echo "==> Updating ${APP_NAME} from origin/${target_branch}"
git fetch origin "${target_branch}"

if [ "${current_branch}" != "${target_branch}" ]; then
  git checkout "${target_branch}"
fi

git pull --ff-only origin "${target_branch}"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Building BrainSync"
npm run build

echo "==> Removing development-only dependencies"
npm prune --omit=dev --no-audit --no-fund

echo "==> Starting or reloading PM2 app: ${APP_NAME}"
pm2 startOrReload ecosystem.config.cjs --only "${APP_NAME}" --update-env
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
