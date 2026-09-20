#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${APP_USER:-openchat}"
APP_DIR="/opt/openchat"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  die "root 권한이 필요합니다: sudo bash deploy/update.sh"
fi

if [ -d "$REPO_DIR/.git" ]; then
  log "git pull"
  sudo -u "$APP_USER" -H git -C "$REPO_DIR" pull --ff-only
fi

log "소스 동기화"
for f in package.json package-lock.json tsconfig.json tsconfig.build.json; do
  cp "$REPO_DIR/$f" "$APP_DIR/$f"
done
rm -rf "$APP_DIR/src" "$APP_DIR/scripts"
cp -r "$REPO_DIR/src" "$APP_DIR/src"
cp -r "$REPO_DIR/scripts" "$APP_DIR/scripts"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "의존성 설치 및 빌드"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null"

log "서비스 재시작"
systemctl restart openchat-opencode
sleep 2
systemctl restart openchat-bot
sleep 3

log "상태"
systemctl --no-pager status openchat-opencode openchat-bot | sed -n '1,20p' || true
journalctl -u openchat-bot -n 15 --no-pager || true
