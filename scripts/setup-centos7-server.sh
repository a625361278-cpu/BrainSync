#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run this setup script as root." >&2
  exit 1
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

install_package_if_missing() {
  local command_name="$1"
  local package_name="$2"

  if command_exists "${command_name}"; then
    echo "==> ${command_name} already exists, skipping ${package_name} install"
    return
  fi

  echo "==> Installing missing package: ${package_name}"
  yum install -y "${package_name}"
}

install_node_if_missing() {
  if command_exists node; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "${major}" -lt 20 ]; then
      echo "Node.js version is lower than 20. Please upgrade Node.js intentionally before deploying BrainSync." >&2
      exit 1
    fi
    echo "==> Node.js already exists and satisfies version requirement"
    return
  fi

  echo "==> Installing missing Node.js 20 LTS from NodeSource"
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  yum install -y nodejs
}

install_nginx_if_missing() {
  if [ "${SKIP_NGINX:-0}" = "1" ]; then
    echo "==> Skipping Nginx install/start because SKIP_NGINX=1"
    return
  fi

  if command_exists nginx; then
    echo "==> Nginx already exists, keeping current Nginx installation and configs unchanged"
    return
  fi

  echo "==> Installing missing Nginx"
  yum install -y nginx
  systemctl enable nginx
  systemctl start nginx
}

install_pm2_if_missing() {
  if command_exists pm2; then
    echo "==> PM2 already exists, skipping global PM2 install"
  else
    echo "==> Installing missing PM2"
    npm install -g pm2
  fi

  if systemctl list-unit-files 2>/dev/null | grep -q '^pm2-root\.service'; then
    echo "==> PM2 startup service already exists, leaving it unchanged"
  else
    echo "==> Registering PM2 startup service"
    pm2 startup systemd -u root --hp /root
  fi
}

echo "==> Checking base packages"
install_package_if_missing curl curl
install_package_if_missing git git

install_nginx_if_missing
install_node_if_missing

if ! command_exists npm; then
  echo "npm command not found after Node.js setup. Please inspect the Node.js installation." >&2
  exit 1
fi

install_pm2_if_missing

echo "==> Server base setup complete"
echo "Next steps:"
echo "1. Clone BrainSync to the server if it is not already present."
echo "2. If the server already has Nginx, keep existing site configs and add only a BrainSync server block or locations."
echo "3. Reuse existing SSL certificate directories when available; create new files only when they do not exist."
echo "4. Create the production .env file with real secrets if it is not already present."
echo "5. Run bash scripts/deploy-server.sh from the project directory."
