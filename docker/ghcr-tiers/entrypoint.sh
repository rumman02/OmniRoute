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

# Embedded chatgpt-web-codex browser (full-browser tier): run the same
# cdp-proxy + headless Chromium pair the compose sidecar runs, as background
# children of this container, and point the app at it on loopback. No-op in
# every other tier (flag unset) and when no Chromium is present.
if [ "${CHATGPT_WEB_CODEX_EMBEDDED_BROWSER:-0}" = "1" ]; then
  # Playwright 1.62+ ships Chromium as Chrome-for-Testing on linux x64, which
  # extracts to chromium-*/chrome-linux64/chrome; the non-CfT arm64 build
  # extracts to chromium-*/chrome-linux/chrome. Match both layouts — a literal
  # '*/chrome-linux/chrome' silently never matches on amd64 (found live on a
  # full-browser deployment: browser never launches, "app only" warning).
  CHROME_BIN=$(find "${PLAYWRIGHT_BROWSERS_PATH:-/home/node/.cache/ms-playwright}" \
    -path '*chrome-linux*/chrome' -type f 2>/dev/null | head -n 1)
  if [ -n "$CHROME_BIN" ] && [ -f /app/cdp-proxy.mjs ]; then
    node /app/cdp-proxy.mjs &
    "$CHROME_BIN" --headless=new --no-sandbox --disable-dev-shm-usage \
      --remote-debugging-port=9222 --user-data-dir=/browser-profile about:blank &
    # Point the app at the in-container proxy unless it is explicitly aimed
    # elsewhere. Both compose files bake the sidecar hostname
    # (http://chatgpt-web-codex-browser:9223) into the env for EVERY tier, so
    # a plain ${VAR:-default} would keep pointing at a sidecar that only
    # exists under the web-cookie profile — treat that compose default as
    # unset here. With the embedded browser up, the browser in this container
    # is the one that matters; to prefer the external sidecar instead, run
    # with CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=0.
    if [ -z "${CHATGPT_WEB_CODEX_CDP_URL:-}" ] \
      || [ "$CHATGPT_WEB_CODEX_CDP_URL" = "http://chatgpt-web-codex-browser:9223" ]; then
      export CHATGPT_WEB_CODEX_CDP_URL="http://127.0.0.1:9223"
    fi
    echo "[entrypoint] embedded chatgpt-web-codex browser up (CDP: 127.0.0.1:9223)"
  else
    echo "[entrypoint] WARNING: CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=1 but no Chromium/cdp-proxy present — app only" >&2
  fi
fi

exec /app/check-permissions.sh "$@"
