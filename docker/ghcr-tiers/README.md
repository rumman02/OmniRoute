# GHCR tier images (fork)

Cumulative pre-built images of OmniRoute, published by
[`.github/workflows/ghcr-tier-images.yml`](../../.github/workflows/ghcr-tier-images.yml)
to `ghcr.io/rumman02/omniroute`. They exist so a Docker Compose deployment
anywhere can `pull` instead of building from source (the upstream images only
publish the `base` and `-web` flavors).

## Tiers

Each tier contains everything the tier above it has:

| Tag                       | Dockerfile target    | Contents                                                                  |
| ------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `base`                    | `runner-base`        | Lean runtime (~500 MB). No browsers, no CLI tools.                        |
| `web`                     | `runner-web`         | +Chromium/Playwright — web-cookie providers (gemini-web, claude-web, …)    |
| `web-cli`                 | `runner-web-cli`     | +`git`, `docker.io`, `docker-compose` and global CLIs: `@openai/codex`, `@anthropic-ai/claude-code`, `droid`, `openclaw` |
| `web-cli-host`            | `runner-web-cli-host`| +host-mode defaults (`CLI_MODE=host`, `/host-*` lookup paths) — see below  |
| `full`                    | `runner-full`        | +`OMNIROLE` entrypoint that can also run as the codex-app-server sidecar   |
| `chatgpt-web-codex-browser` | sidecar Dockerfile | Chromium + CDP proxy for ChatGPT Web (Codex).                             |

Tags per tier: the mutable tier name (`:web-cli`), the version at build time
(`:3.8.51-web-cli`), and `:latest` (alias of `base`). Multi-arch:
`linux/amd64` + `linux/arm64`.

## Usage

```bash
docker pull ghcr.io/rumman02/omniroute:web-cli
docker run -p 20128:20128 -v ./data:/app/data ghcr.io/rumman02/omniroute:web-cli
```

Or with the compose file that consumes these images (no `build:` anywhere):

```bash
cp .env.example .env
docker compose -f docker-compose.ghcr.yml up -d                                # base
OMNIROUTE_TIER=web-cli docker compose -f docker-compose.ghcr.yml up -d        # tier select
OMNIROUTE_TIER=full docker compose -f docker-compose.ghcr.yml \
  --profile codex-app-server up -d                                            # + app-server sidecar
```

## The `host` tier caveat

"Host" cannot be baked into an image — it **is** the host. The `web-cli-host`
tier bakes the same *defaults* the `host` profile of `docker-compose.yml` sets
(`CLI_MODE=host`, `CLI_EXTRA_PATHS=/host-local/bin:/host-node/bin`,
`CLI_CONFIG_HOME=/host-home`, `CLI_ALLOW_CONFIG_WRITES=true`); the actual
binaries and config homes still have to be volume-mounted. Without the mounts
the tier still works — host lookup misses and the baked-in global CLIs are used.
See the commented mounts block in `docker-compose.ghcr.yml`. All four env
defaults are plain `ENV`, overridable at runtime with `-e`.

## The codex-app-server role (`full` only)

The `full` image's entrypoint (`docker/ghcr-tiers/entrypoint.sh`) switches on
`OMNIROLE`:

- `omniroute` (default) — the Next.js server, identical to any other tier.
- `codex-app-server` — runs `codex app-server --listen ws://0.0.0.0:1456
  --ws-auth capability-token`, minting the capability token on first boot; the
  same command the upstream `codex-app-server` compose profile runs inline.
  The inherited HEALTHCHECK probes the HTTP app, so compose overrides it for
  this role (see the `codex-app-server` service in `docker-compose.ghcr.yml`).

This also fixes the gap in the upstream compose file, whose
`codex-app-server` sidecar uses `omniroute:base` — an image that does **not**
contain the `codex` binary (it is installed only in the unpublished
`runner-cli` stage). The `full`/`web-cli` tiers contain it.

## Visibility

GHCR packages inherit private visibility by default. For passwordless
`docker pull` anywhere, flip the package to public once:
repo → *Packages* → `omniroute` → *Package settings* → *Danger Zone* →
*Change visibility* → Public.
