#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo bash deploy/scripts/bootstrap-vm.sh staging <deploy-user> "<ssh-public-key>" [ssh-port]
  bash deploy/scripts/bootstrap-vm.sh --check staging <deploy-user> "<ssh-public-key>" [ssh-port]

This script supports Ubuntu 22.04 LTS only. It installs Docker Engine and Compose
from Docker's official apt repository, creates the deploy user and authorized key,
creates /opt/supplier-henkaten/staging, and enables UFW for SSH/HTTP/HTTPS.
EOF
}

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
  shift
fi
[[ $# -ge 3 && $# -le 4 ]] || {
  usage
  exit 1
}

APP_ENV="$1"
DEPLOY_USER="$2"
DEPLOY_SSH_PUBLIC_KEY="$3"
SSH_PORT="${4:-22}"

[[ "${APP_ENV}" == "staging" ]] || {
  echo "Only the staging environment is enabled by this bootstrap script." >&2
  exit 1
}
[[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || {
  echo "Deploy user is invalid." >&2
  exit 1
}
[[ "${DEPLOY_SSH_PUBLIC_KEY}" =~ ^ssh-(ed25519|rsa)[[:space:]]+[A-Za-z0-9+/=]+([[:space:]].*)?$ ]] || {
  echo "SSH public key has an unsupported shape." >&2
  exit 1
}
if [[ ! "${SSH_PORT}" =~ ^[0-9]+$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then
  echo "SSH port must be between 1 and 65535." >&2
  exit 1
fi

[[ -r /etc/os-release ]] || {
  echo "Cannot identify the operating system." >&2
  exit 1
}
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "22.04" ]] || {
  echo "Ubuntu 22.04 LTS is required." >&2
  exit 1
}

BASE_DIR="/opt/supplier-henkaten/staging"
if "${CHECK_ONLY}"; then
  printf 'Bootstrap inputs are valid for Ubuntu 22.04 staging at %s.\n' "${BASE_DIR}"
  exit 0
fi

[[ "${EUID}" -eq 0 ]] || {
  echo "Run this script as root or with sudo." >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg jq git ufw util-linux
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

architecture="$(dpkg --print-architecture)"
codename="$(
  # shellcheck disable=SC1091
  source /etc/os-release
  printf '%s' "${VERSION_CODENAME}"
)"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
  "${architecture}" "${codename}" >/etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"
if getent group 2000 >/dev/null 2>&1 && [[ "$(getent group 2000 | cut -d: -f1)" != "supplier-henkaten-data" ]]; then
  echo "GID 2000 is already assigned; cannot create the application data group safely." >&2
  exit 1
fi
if getent group supplier-henkaten-data >/dev/null 2>&1; then
  [[ "$(getent group supplier-henkaten-data | cut -d: -f3)" == "2000" ]] || {
    echo "supplier-henkaten-data exists with a GID other than 2000." >&2
    exit 1
  }
else
  groupadd --gid 2000 supplier-henkaten-data
fi
usermod -aG supplier-henkaten-data "${DEPLOY_USER}"

USER_HOME="$(getent passwd "${DEPLOY_USER}" | cut -d: -f6)"
SSH_DIR="${USER_HOME}/.ssh"
AUTHORIZED_KEYS="${SSH_DIR}/authorized_keys"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${SSH_DIR}"
touch "${AUTHORIZED_KEYS}"
chmod 600 "${AUTHORIZED_KEYS}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTHORIZED_KEYS}"
grep -Fqx "${DEPLOY_SSH_PUBLIC_KEY}" "${AUTHORIZED_KEYS}" || printf '%s\n' "${DEPLOY_SSH_PUBLIC_KEY}" >>"${AUTHORIZED_KEYS}"

install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" \
  "${BASE_DIR}" \
  "${BASE_DIR}/releases" \
  "${BASE_DIR}/incoming" \
  "${BASE_DIR}/shared" \
  "${BASE_DIR}/shared/postgres-data" \
  "${BASE_DIR}/shared/member-photos" \
  "${BASE_DIR}/shared/caddy-data" \
  "${BASE_DIR}/shared/caddy-config" \
  "${BASE_DIR}/shared/deployment-state"
chown 70:70 "${BASE_DIR}/shared/postgres-data"
chmod 0700 "${BASE_DIR}/shared/postgres-data"
chown 65532:2000 "${BASE_DIR}/shared/member-photos"
chmod 2770 "${BASE_DIR}/shared/member-photos"
chown "${DEPLOY_USER}:2000" \
  "${BASE_DIR}/shared/caddy-data" \
  "${BASE_DIR}/shared/caddy-config"
chmod 2770 \
  "${BASE_DIR}/shared/caddy-data" \
  "${BASE_DIR}/shared/caddy-config"

ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat <<EOF
VM bootstrap complete.
Environment: staging
Deploy user: ${DEPLOY_USER}
Base directory: ${BASE_DIR}

Reconnect before testing Docker group membership:
  docker version
  docker compose version
EOF
