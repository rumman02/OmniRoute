#!/bin/sh
set -e

# Role entrypoint for the cumulative GHCR tier images (Dockerfile `runner-full`).
# OMNIROLE selects what this container runs:
#
#   omniroute (default)  the Next.js server — delegates to the stock
#                        /app/check-permissions.sh entrypoint (CMD inherited)
#   codex-app-server     the Codex CLI app-server WS sidecar on :1456 — the same
#                        command the docker-compose.yml `codex-app-server`
#                        profile runs inline: mint the capability token on first
#                        boot if absent, then exec `codex app-server`.
ROLE="${OMNIROLE:-omniroute}"

if [ "$ROLE" = "codex-app-server" ]; then
  TOKEN_FILE="${OMNIROUTE_CODEX_APPSERVER_WS_TOKEN_FILE:-/run/codex-appserver/token}"
  LISTEN_PORT="${OMNIROUTE_CODEX_APPSERVER_PORT:-1456}"
  mkdir -p "$(dirname "$TOKEN_FILE")"
  if [ ! -s "$TOKEN_FILE" ]; then
    # 32-byte hex capability token; shared with the app via the token volume.
    TF="$TOKEN_FILE" node -e 'require("fs").writeFileSync(process.env.TF, require("crypto").randomBytes(32).toString("hex"))' 2>/dev/null || \
      { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"; }
    chmod 600 "$TOKEN_FILE"
  fi
  exec codex app-server \
    --listen "ws://0.0.0.0:${LISTEN_PORT}" \
    --ws-auth capability-token \
    --ws-token-file "$TOKEN_FILE"
fi

exec /app/check-permissions.sh "$@"
