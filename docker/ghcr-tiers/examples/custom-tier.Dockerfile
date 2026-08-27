# ──────────────────────────────────────────────────────────────────────
#  OmniRoute — custom tier example (extend a published GHCR tier)
# ──────────────────────────────────────────────────────────────────────
#
#  Build a private image on top of a published tier instead of rebuilding
#  OmniRoute from source — the heavy layers (app + Chromium + CLIs) come
#  from the registry, your additions are a thin layer on top.
#
#  Build & push:
#    docker build -f custom-tier.Dockerfile \
#      -t ghcr.io/<you>/omniroute:web-cli-plus .
#    docker push ghcr.io/<you>/omniroute:web-cli-plus
#
#  Run (same env/volumes as the tier it extends):
#    docker run -p 20128:20128 -v omniroute-data:/app/data \
#      ghcr.io/<you>/omniroute:web-cli-plus
# ──────────────────────────────────────────────────────────────────────

# Any tier works as the base — web-cli is the sweet spot (app + browser +
# CLIs). Swap for :full to also get the OMNIROLE codex-app-server entrypoint,
# or :web-cli-host for the host-mode defaults.
FROM ghcr.io/rumman02/omniroute:web-cli

# The runtime user is `node`; switch to root only for installs, then back.
USER root

# Example 1 — extra CLI tools for the dashboard's agent features.
# (These are the same packages the upstream runner-cli stage installs.)
RUN --mount=type=cache,target=/root/.npm \
  npm install -g --no-audit --no-fund \
  @openai/codex @anthropic-ai/claude-code droid openclaw@latest

# Example 2 — extra OS packages, e.g. ripgrep for agent file search.
# Use the same apt cache-mount pattern the upstream Dockerfile uses.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  apt-get update \
  && apt-get install -y --no-install-recommends ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Example 3 — bake config defaults (override at runtime with -e).
# ENV OMNIROUTE_MEMORY_MB=2048

# Back to the unprivileged runtime user — the inherited ENTRYPOINT/CMD
# (check-permissions.sh → node dev/run-standalone.mjs) and HEALTHCHECK
# keep working as in the parent tier.
USER node
