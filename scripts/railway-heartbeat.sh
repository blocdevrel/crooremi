#!/bin/sh
# Railway cron entrypoint — call Remifi heartbeat then exit.
set -eu

URL="${HEARTBEAT_URL:-https://remifi.up.railway.app/api/schedules/heartbeat}"

if [ -z "${EXECUTE_API_KEY:-}" ]; then
  echo "[heartbeat] EXECUTE_API_KEY is required" >&2
  exit 1
fi

echo "[heartbeat] POST $URL"
HTTP_CODE=$(curl -sS -o /tmp/heartbeat-body.json -w "%{http_code}" \
  -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-api-key: ${EXECUTE_API_KEY}")

echo "[heartbeat] HTTP $HTTP_CODE"
cat /tmp/heartbeat-body.json
echo

case "$HTTP_CODE" in
  2*) exit 0 ;;
  *) exit 1 ;;
esac
