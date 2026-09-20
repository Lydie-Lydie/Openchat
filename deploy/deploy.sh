#!/usr/bin/env bash
set -euo pipefail

# 로컬에서 실행: 저장소를 서버로 동기화한 뒤 원격 update.sh 를 돌린다.
#   user_HOST=root@64.177.47.245 bash deploy/deploy.sh
#
# --delete 를 사용하므로 서버에서 삭제된 파일도 반영된다.
# node_modules/dist/data/secrets/.env 는 제외되어 보호된다.

HOST="${user_HOST:-}"
REMOTE_DIR="${user_REMOTE_DIR:-/root/openchat}"

if [ -z "$HOST" ]; then
  printf 'usage: user_HOST=user@server bash deploy/deploy.sh\n' >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '\n\033[1;36m==> sync %s -> %s:%s\033[0m\n' "$REPO_DIR" "$HOST" "$REMOTE_DIR"
rsync -az --delete -e ssh \
  --exclude node_modules \
  --exclude dist \
  --exclude data \
  --exclude secrets \
  --exclude .git \
  --exclude .env \
  "$REPO_DIR/" "$HOST:$REMOTE_DIR/"

printf '\n\033[1;36m==> remote update\033[0m\n'
ssh "$HOST" "cd '$REMOTE_DIR' && sudo bash deploy/update.sh"

printf '\n\033[1;32m배포 완료\033[0m\n'
