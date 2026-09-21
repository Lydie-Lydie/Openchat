#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${APP_USER:-openchat}"
OC_USER="${OC_USER:-${APP_USER}-oc}"
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
rm -rf "$APP_DIR/src" "$APP_DIR/scripts" "$APP_DIR"/src.bak-* "$APP_DIR"/scripts.bak-*
cp -r "$REPO_DIR/src" "$APP_DIR/src"
cp -r "$REPO_DIR/scripts" "$APP_DIR/scripts"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
mkdir -p "$APP_DIR/workspace"
if id -u "$OC_USER" >/dev/null 2>&1; then
  chown -R "$OC_USER:$OC_USER" "$APP_DIR/workspace"
else
  chown -R "$APP_USER:$APP_USER" "$APP_DIR/workspace"
fi

log "의존성 설치 및 빌드"
sudo -u "$APP_USER" -H env "PATH=/usr/local/bin:/usr/bin:/bin" bash -c \
  "cd '$APP_DIR' && npm ci --no-audit --no-fund >/dev/null && NODE_OPTIONS=--max-old-space-size=512 npm run build >/dev/null"

log "systemd 및 egress 필터"
cp "$REPO_DIR/deploy/openchat-opencode.service" "$REPO_DIR/deploy/openchat-bot.service" /etc/systemd/system/
install -m 755 "$REPO_DIR/deploy/openchat-egress-apply.sh" /usr/local/sbin/openchat-egress-apply
mkdir -p /etc/openchat
printf 'OC_USER=%s\n' "$OC_USER" > /etc/openchat/egress.env
chmod 644 /etc/openchat/egress.env
cp "$REPO_DIR/deploy/openchat-egress.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable openchat-egress.service >/dev/null 2>&1 || true
systemctl start openchat-egress.service || true

log "서비스 재시작"
systemctl restart openchat-opencode
sleep 5
systemctl restart openchat-bot
sleep 5

log "상태"
systemctl --no-pager status openchat-egress openchat-opencode openchat-bot | sed -n '1,24p' || true
printf 'egress rules: v4=%s v6=%s\n' \
  "$(iptables -S OUTPUT 2>/dev/null | grep -c 'uid-owner')" \
  "$(ip6tables -S OUTPUT 2>/dev/null | grep -c 'uid-owner')"
journalctl -u openchat-bot -n 15 --no-pager || true
