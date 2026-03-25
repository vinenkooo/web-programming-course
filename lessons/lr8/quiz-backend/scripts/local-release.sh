#!/usr/bin/env bash
set -e

tag=${1:-$(date +%Y%m%d-%H%M%S)}
image="quiz-backend:$tag"

echo "Build: $image"
docker build -t "$image" .

echo "Start docker compose..."
BACKEND_IMAGE="$image" docker compose up -d db backend

echo "Smoke test..."
sleep 5

if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health || true)" != "200" ]; then
  echo "health not ok"
  exit 1
fi

if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/auth/me || true)" != "401" ]; then
  echo "api /api/auth/me not ok"
  exit 1
fi

mkdir -p .release
if [ -f .release/current_tag ]; then
  cp .release/current_tag .release/previous_tag
fi
echo "$tag" > .release/current_tag

echo "Done. Current tag: $tag"
