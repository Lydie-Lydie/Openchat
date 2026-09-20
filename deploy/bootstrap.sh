#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${APP_USER:-openchat}"
user_HOME="/home/${APP_USER}"
APP_DIR="/opt/openchat"
CONF_DIR="/etc/openchat"
ENV_FILE="${CONF_DIR}/openchat.env"
OPENCODE_VERSION="${OPENCODE_VERSION:-1.18.31}"
NODE_MAJOR="${NODE_MAJOR:-24}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok() { printf '    ok: %s\n' "$1"; }
warn() { printf '\033[1;33m    warn: %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  die "root 권한이 필요합니다: sudo bash deploy/bootstrap.sh"
fi

log "1/9 swap (${SWAP_SIZE})"
if [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" -eq 0 ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null \
      || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
  ok "swap 활성화"
else
  ok "기존 swap 사용"
fi

log "2/9 네트워크 사전 점검"
if ! curl -4 -sS -m 15 -o /dev/null https://discord.com/api/v10/gateway; then
  die "Discord에 IPv4로 접속할 수 없습니다."
fi
ok "Discord IPv4 도달"

log "3/9 기본 도구 확인"
for c in curl git tar xz; do
  command -v "$c" >/dev/null 2>&1 || die "$c 가 필요합니다."
done
ok "curl/git/tar/xz 확인"

log "4/9 Node.js ${NODE_MAJOR} (공식 바이너리, dnf 미사용)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  TARBALL="$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/" \
    | grep -oE "node-v${NODE_MAJOR}\\.[0-9]+\\.[0-9]+-linux-x64\\.tar\\.xz" | head -1)"
  [ -n "$TARBALL" ] || die "Node tarball을 찾지 못했습니다."
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${TARBALL}" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  hash -r
fi
for b in node npm npx corepack; do
  if [ -e "/usr/local/bin/$b" ] && [ ! -e "/usr/bin/$b" ]; then
    ln -sf "/usr/local/bin/$b" "/usr/bin/$b"
  fi
done
hash -r
ok "node $(node -v) / npm $(npm -v)"

log "5/9 사용자 및 디렉터리"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -m -d "$user_HOME" -s /bin/bash "$APP_USER"
fi
mkdir -p "$APP_DIR" "$CONF_DIR" "$APP_DIR/workspace" "$APP_DIR/data"
mkdir -p "$user_HOME/.local/share" "$user_HOME/.local/state" "$user_HOME/.cache" "$user_HOME/.config"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$user_HOME"
chmod 700 "$user_HOME" "$user_HOME/.local" "$user_HOME/.local/state"
if command -v restorecon >/dev/null 2>&1; then restorecon -R "$user_HOME" >/dev/null 2>&1 || true; fi
ok "$APP_USER / $APP_DIR"

log "6/9 OpenCode CLI"
if ! /usr/local/bin/opencode --version >/dev/null 2>&1; then
  npm install -g "opencode-ai@${OPENCODE_VERSION}" >/dev/null
fi
[ -x /usr/local/bin/opencode ] || die "opencode 전역 설치 실패"
ok "$(/usr/local/bin/opencode --version)"

log "7/9 코드 배치 및 빌드"
for f in package.json package-lock.json tsconfig.json tsconfig.build.json; do
  cp "$REPO_DIR/$f" "$APP_DIR/$f"
done
rm -rf "$APP_DIR/src" "$APP_DIR/scripts"
cp -r "$REPO_DIR/src" "$APP_DIR/src"
cp -r "$REPO_DIR/scripts" "$APP_DIR/scripts"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" -H env "PATH=/usr/local/bin:/usr/bin:/bin" bash -c \
  "cd '$APP_DIR' && npm ci --no-audit --no-fund >/dev/null && NODE_OPTIONS=--max-old-space-size=512 npm run build >/dev/null"
ok "빌드 완료"

log "8/9 환경 파일"
if [ -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env" "$ENV_FILE"
elif [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

PW="$(grep -E '^OPENCODE_SERVER_PASSWORD=.' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
if [ -z "$PW" ]; then
  PW="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
set_env OPENCODE_SERVER_PASSWORD "$PW"
set_env OPENCODE_BASE_URL "http://127.0.0.1:4096"
set_env DB_PATH "$APP_DIR/data/openchat.db"
set_env NODE_ENV "production"
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"
ok "$ENV_FILE 준비"

if [ -n "${user_AUTH_JSON:-}" ] && [ -f "${user_AUTH_JSON}" ]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$user_HOME/.local/share/opencode"
  install -o "$APP_USER" -g "$APP_USER" -m 600 "$user_AUTH_JSON" \
    "$user_HOME/.local/share/opencode/auth.json"
  ok "auth.json 복사"
fi

log "9/9 systemd 및 SELinux"
cp "$REPO_DIR/deploy/openchat-opencode.service" "$REPO_DIR/deploy/openchat-bot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable openchat-opencode openchat-bot >/dev/null 2>&1 || true

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  # 유닛의 SELinuxContext=unconfined_service_t 가 동작하려면
  # opencode 바이너리가 entrypoint 로 허용되는 bin_t 여야 한다.
  if command -v semanage >/dev/null 2>&1; then
    semanage fcontext -a -t bin_t "/usr/local/lib/node_modules/opencode-ai(/.*)?" 2>/dev/null || true
    restorecon -R /usr/local/lib/node_modules/opencode-ai >/dev/null 2>&1 || true
    ok "SELinux: opencode-ai 를 bin_t 로 라벨링"
  else
    warn "semanage 없음: SELinux Enforcing 환경에서 서비스가 실패할 수 있습니다"
  fi
fi
ok "서비스 등록"

printf '\n\033[1;32m부트스트랩 완료\033[0m\n'
