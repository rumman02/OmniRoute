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
| `base`                    | `runner-base`        | Lean runtime (~1.1 GB compressed). No browsers, no CLI tools.             |
| `web`                     | `runner-web`         | +Chromium/Playwright — web-cookie providers (gemini-web, claude-web, …)    |
| `web-cli`                 | `runner-web-cli`     | +`git`, `docker.io`, `docker-compose` and global CLIs: `@openai/codex`, `@anthropic-ai/claude-code`, `droid`, `openclaw` |
| `web-cli-host`            | `runner-web-cli-host`| +host-mode defaults (`CLI_MODE=host`, `/host-*` lookup paths) — see below  |
| `full`                    | `runner-full`        | +`OMNIROLE` entrypoint that can also run as the codex-app-server sidecar   |
| `full-browser`            | `runner-full-browser`| +embedded chatgpt-web-codex Chromium (the sidecar baked in) — see below    |
| `chatgpt-web-codex-browser` | sidecar Dockerfile | Chromium + CDP proxy for ChatGPT Web (Codex).                             |

Tags per tier: the mutable tier name (`:web-cli`), the `latest-<tier>` channel
(`:latest-web-cli` — upstream convention, bare `:latest` is the base flavor),
and the version at build time (`:3.8.51-web-cli`, bare `:3.8.51` is base).
Multi-arch: `linux/amd64` + `linux/arm64`.

## Usage

The package is public — no `docker login` needed anywhere:

```bash
docker pull ghcr.io/rumman02/omniroute:web-cli
docker run -p 20128:20128 -v ./data:/app/data ghcr.io/rumman02/omniroute:web-cli
```

Ready-made examples live in [`examples/`](examples/):

- [`docker-compose.standalone.yml`](examples/docker-compose.standalone.yml) —
  single file, zero config: copy to any machine and `docker compose up -d`.
  Secrets auto-generate on first boot into the data volume; tier selected via
  `OMNIROUTE_TIER`; `web-cookie` / `codex-app-server` profiles for sidecars.
- [`custom-tier.Dockerfile`](examples/custom-tier.Dockerfile) — build a private
  image on top of a published tier (extra CLIs/OS packages as thin layers).

### Environment variables

The only **required** env setup is secrets on first boot — everything else has
sane defaults. Minimal `.env`:

```bash
JWT_SECRET=<openssl rand -base64 48>
API_KEY_SECRET=<openssl rand -hex 32>
INITIAL_PASSWORD=<your dashboard password — set this FIRST boot, rotate after login>
STORAGE_ENCRYPTION_KEY=<openssl rand -hex 32>
```

The useful runtime knobs (all optional):

| Env var | Default | Notes |
| --- | --- | --- |
| `DATA_DIR` | `/app/data` | **Mount a volume here** or your data vanishes with the container. |
| `PORT` | `20128` | Dashboard + API on one port. |
| `OMNIROUTE_MEMORY_MB` | `1024` | Runtime heap. Raise to `2048` for big fusion panels. |
| `REQUIRE_API_KEY` | `false` | Set `true` when exposing beyond localhost. |
| `REDIS_URL` | `redis://redis:6379` | Only when running the compose stack. |
| `OMNIROLE` (full/full-browser tiers) | `omniroute` | `codex-app-server` switches the container to the sidecar role. |
| `CLI_MODE` (web-cli-host tier) | `host` (baked) | Override to `auto`/`container` to use the baked-in CLIs instead. |
| `CHATGPT_WEB_CODEX_EMBEDDED_BROWSER` (full-browser tier) | `1` (baked) | `0` disables the embedded browser — app only, or point `CHATGPT_WEB_CODEX_CDP_URL` at the external sidecar. |

### Which tag for which job

| You want | Tag | Extra env / mounts |
| --- | --- | --- |
| Plain proxy, any API-key/OAuth provider | `:base` / `:latest` | none |
| Web-cookie providers (gemini-web, claude-web, claude-turnstile) | `:web` / `:latest-web` | none — Chromium is baked in; add the `chatgpt-web-codex-browser` sidecar for ChatGPT Web (Codex) |
| Agentic workflows — Codex/Claude Code/droid/openclaw CLIs usable from inside the dashboard | `:web-cli` / `:latest-web-cli` | mount `-v /var/run/docker.sock:/var/run/docker.sock` if the CLIs need Docker |
| Your host's own CLI binaries + configs (host mode) | `:web-cli-host` / `:latest-web-cli-host` | mount `~/.codex`, `~/.claude`, `~/.local/bin`, … at the `/host-*` paths (see compose comments) |
| Everything incl. the codex-app-server sidecar role | `:full` / `:latest-full` | sidecar: `-e OMNIROLE=codex-app-server` + token/`~/.codex` volumes |
| All of the above AND the ChatGPT Web (Codex) browser in the SAME container | `:full-browser` / `:latest-full-browser` | none — cdp-proxy + Chromium launch automatically on `127.0.0.1:9223`; mount `-v …:/browser-profile` to keep the login session; disable with `-e CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=0` |
| ChatGPT Web (Codex) Chromium CDP sidecar | `:chatgpt-web-codex-browser` / `:latest-chatgpt-web-codex-browser` | `shm_size: 2gb`; app needs `CHATGPT_WEB_CODEX_CDP_URL=http://<sidecar>:9223` |
| Pin an exact build | `:3.8.51` … `:3.8.51-full-browser` | none — immutable per version |

Bare `:latest` and `:3.8.51` are the **base** flavor (upstream convention);
flavored tags carry the suffix (`:latest-web-cli`, `:3.8.51-web-cli`).

### Compose (no local build)

Or with the compose file that consumes these images (no `build:` anywhere):

```bash
cp .env.example .env   # fill the 4 secrets above
docker compose -f docker-compose.ghcr.yml up -d                                # base
OMNIROUTE_TIER=web-cli docker compose -f docker-compose.ghcr.yml up -d        # tier select
OMNIROUTE_TIER=full docker compose -f docker-compose.ghcr.yml \
  --profile codex-app-server up -d                                            # + app-server sidecar
```

To run it as a host's **default compose file** — no `-f`, no shell env var, just
`docker compose up -d`: copy the standalone example to `compose.yaml` (Compose's
default lookup name) and set the tier in a `.env` file beside it. Compose
auto-reads `.env` for variable interpolation, so `OMNIROUTE_TIER` there selects
the image tag without a command-line prefix (note: on a deployment host — inside
the repo checkout, `docker compose up` would find the build-based
`docker-compose.yml` instead):

```bash
cp docker/ghcr-tiers/examples/docker-compose.standalone.yml compose.yaml
echo "OMNIROUTE_TIER=full-browser" >> .env      # plus the secrets, first boot
docker compose up -d
```

### What differs between tiers at runtime

Nothing in the compose service definition — every tier takes the same env
block, ports, volumes and healthcheck; only the image tag changes
(`OMNIROUTE_TIER`). There is no per-tier env add/sub to do. The differences
live in the image itself:

| Tier | New baked-in env vs the tier below | Entrypoint | You typically add |
| --- | --- | --- | --- |
| `base` | — | `/app/check-permissions.sh` | nothing |
| `web` | `PLAYWRIGHT_BROWSERS_PATH` | 〃 | nothing; `--profile web-cookie` only for ChatGPT Web (Codex) |
| `web-cli` | — (content only: CLIs + git/docker) | 〃 | `- /var/run/docker.sock:/var/run/docker.sock` if the CLIs need Docker |
| `web-cli-host` | `CLI_MODE=host`, `CLI_EXTRA_PATHS`, `CLI_CONFIG_HOME=/host-home`, `CLI_ALLOW_CONFIG_WRITES=true` | 〃 | the `/host-*` volume mounts (see compose comments) |
| `full` | `OMNIROLE=omniroute` | `/app/entrypoint.sh` (role switch; delegates to check-permissions.sh) | nothing; `-e OMNIROLE=codex-app-server` runs the sidecar role |
| `full-browser` | `CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=1` | 〃 | `- …:/browser-profile` volume to persist the browser login session |

Every baked-in env is a plain `ENV` — override any of them per-run with `-e` /
compose `environment:`. `CMD` (`node dev/run-standalone.mjs`), the
`HEALTHCHECK` and the non-root `node` user are identical across all tiers.

Sizes (compressed, linux/amd64, measured 2026-08-27 from the registry):
`base` ≈ 1.1 GB, `web` ≈ 1.5 GB, and `web-cli`/`web-cli-host`/`full`/
`full-browser` all ≈ 2.1 GB — the steps above `web-cli` add only KB-scale
layers (entrypoint + cdp-proxy scripts), so pull cost between them is ~zero
(shared layers). Sidecar ≈ 0.9 GB.

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

## The embedded browser tier (`full-browser` only)

`full-browser` bakes the entire `chatgpt-web-codex-browser` sidecar into the
image: the same `cdp-proxy.mjs` + headless Chromium pair, launched as
background children by the role entrypoint (`CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=1`
is the tier default), with the app pointed at `http://127.0.0.1:9223`. One
container, zero extra services — good for laptops and single-container hosts.

The trade-off vs the sidecar: app and browser now share a container, so a
Chromium crash takes the whole container down (restart to recover) and shares
the app's memory ceiling. For production, the `web-cookie` sidecar profile
remains the more robust layout. Mount a volume at `/browser-profile` to keep
the ChatGPT login session across restarts.

**CDP URL precedence.** Both compose files bake
`CHATGPT_WEB_CODEX_CDP_URL=http://chatgpt-web-codex-browser:9223` into the app
environment for every tier (it is what makes the `web-cookie` sidecar work
zero-config on the other tiers). The entrypoint treats that compose default as
*unset* when the embedded browser is up, so `full-browser` still lands on
`http://127.0.0.1:9223` under compose — the embedded browser wins. Any other
explicitly-set URL (e.g. a remote browser) is respected as-is. To run the
external `web-cookie` sidecar instead of the embedded browser, keep the profile
and set `-e CHATGPT_WEB_CODEX_EMBEDDED_BROWSER=0`.

## Keeping the images current

Two layers, both automated:

1. **Sync from upstream** — `.github/workflows/ghcr-tier-sync.yml` runs weekly
   (Mondays ~04:23 UTC) and on demand: it merges the highest upstream
   `diegosouzapw/OmniRoute` `release/v*` branch into `feat/ghcr-tier-images`,
   pushes, and dispatches a fresh tier-image build. A merge conflict opens an
   issue with the file list instead of failing silently — resolve locally once
   and push. Manual equivalent:

   ```bash
   git remote add upstream https://github.com/diegosouzapw/OmniRoute.git  # once
   git fetch upstream
   git checkout feat/ghcr-tier-images
   git merge upstream/release/v3.8.51   # or the newest release/v*
   git push                              # triggers the tier build automatically
   ```

2. **Rebuild the images** — any push to `feat/ghcr-tier-images` (or a manual
   dispatch from the Actions tab) re-runs `ghcr-tier-images.yml` and republishes
   every tier with fresh `latest-*` and `<version>-*` tags.

### Updating a running deployment

Neither of the two layers above reaches a host that already pulled an image:
GHCR tags moving does nothing to running containers — a container keeps the
image it started with until the **deployment host** re-pulls. The update step
always runs on the host:

```bash
docker compose pull && docker compose up -d   # -f … or the compose.yaml pattern
```

`up -d` recreates only the services whose image actually moved. Note that the
versioned tags (`:3.8.51-web-cli`) are re-pointed at new digests by every
upstream-sync rebuild — pin by **digest** (`:full-browser@sha256:…`) for a
deploy that never moves.

To automate the host side, pick one:

- **Host cron** — no extra moving parts, runs in your maintenance window:

  ```bash
  # crontab -e — daily at 04:37
  37 4 * * * cd /opt/omniroute && docker compose pull --quiet && docker compose up -d
  ```

- **Watchtower** — a companion container that re-pulls on a schedule. The
  standalone example ships one behind the `auto-update` profile; for other
  compose files add:

  ```yaml
    watchtower:
      image: ghcr.io/nicholas-fedor/watchtower:latest  # maintained fork of containrrr/watchtower
      restart: unless-stopped
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
      environment:
        - WATCHTOWER_POLL_INTERVAL=86400   # check daily (seconds)
        - WATCHTOWER_CLEANUP=true          # prune superseded image layers
  ```

  An update **recreates the app container** — in-flight requests drop. Pick a
  quiet interval, or set `WATCHTOWER_LABEL_ENABLE=true` and label only the
  services you want auto-updated.

## Visibility

The package is **public** (set 2026-08-27) — `docker pull
ghcr.io/rumman02/omniroute:<tag>` works from any machine with no login. If it
ever needs to go private: repo → *Packages* → `omniroute` → *Package settings* →
*Danger Zone* → *Change visibility* — then every host needs
`docker login ghcr.io` with a PAT that has `read:packages`.
