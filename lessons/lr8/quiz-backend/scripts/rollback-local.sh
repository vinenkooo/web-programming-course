#!/usr/bin/env bash
set -e

if [ ! -f .release/previous_tag ]; then
  echo "No previous tag"
  exit 1
fi

prev_tag=$(cat .release/previous_tag)
image="quiz-backend:$prev_tag"

echo "Rollback to: $image"
BACKEND_IMAGE="$image" docker compose up -d backend

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

if [ -f .release/current_tag ]; then
  cp .release/current_tag .release/previous_tag
fi
echo "$prev_tag" > .release/current_tag

echo "Done. Current tag: $prev_tag"
