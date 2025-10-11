#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"

echo "== UBQ.FI Router smoke test =="
echo "Target: $BASE (set BASE env to override)"

echo "-- Healthcheck"
curl -sS -D - "$BASE/__health" -o /dev/null | sed -n '1,5p'

echo "-- Service root (Host: ubq.fi)"
curl -sS -I -H 'Host: ubq.fi' "$BASE/" | sed -n '1,8p'

echo "-- Service subdomain pay (Host: pay.ubq.fi)"
curl -sS -I -H 'Host: pay.ubq.fi' "$BASE/" | sed -n '1,8p'

echo "-- Plugin alias (Host: os-command-config.ubq.fi)"
curl -sS -I -H 'Host: os-command-config.ubq.fi' "$BASE/manifest.json" | sed -n '1,8p'

echo "-- RPC OPTIONS (Host: ubq.fi → /rpc/1)"
curl -sS -X OPTIONS -D - -H 'Host: ubq.fi' "$BASE/rpc/1" -o /dev/null | sed -n '1,12p'

cat <<'EOF'

Notes:
- Ensure `wrangler dev` is running in another terminal before running this script.
- Service and plugin requests proxy to Deno Deploy; we use -I (HEAD) to avoid large bodies.
- RPC OPTIONS is validated locally (204 + CORS headers) without hitting upstream.
EOF

