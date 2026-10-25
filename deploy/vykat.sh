#!/usr/bin/env bash
# Выкат «Вдвоём» на сервер: код rsync-ом, сборка образа там же, перезапуск.
#   deploy/vykat.sh            — код и контент
#   deploy/vykat.sh --kontent  — только data/ (вопросы, фильмы, постеры), без пересборки
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${DEPLOY_HOST:?укажи DEPLOY_HOST, например root@203.0.113.10}
KEY=${DEPLOY_KEY:-~/.ssh/id_ed25519}
DIR=${DEPLOY_DIR:-/opt/vdvoyom}
SSH="ssh -i $KEY"

rsync -az --delete -e "$SSH" server/data/ "$HOST:$DIR/server/data/"
if [[ "${1:-}" == "--kontent" ]]; then
  $SSH "$HOST" "cd $DIR && docker compose restart app"
  echo "контент обновлён"
  exit 0
fi

rsync -az --delete -e "$SSH" \
  --exclude node_modules --exclude dist --exclude 'dev.db*' --exclude 'imdb-ratings.db*' --exclude film-posters --exclude .git --exclude .env --exclude 'server/data' --exclude _istochniki --exclude issledovanie --exclude '*.bak-*' \
  ./ "$HOST:$DIR/"
$SSH "$HOST" "cd $DIR && docker compose up -d --build && docker image prune -f >/dev/null"
sleep 4
$SSH "$HOST" "cd $DIR && docker compose ps --format '{{.Name}} {{.Status}}' && docker compose logs --tail 8 app"
