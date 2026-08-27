// Wiring guard for the fork-only GHCR tier images (docker/ghcr-tiers/README.md).
// Pins the three things the pipeline depends on: the cumulative Dockerfile
// stage chain, the role-switching entrypoint, and the workflow/compose files
// referencing the same image name. Pure file/regex assertions — no fixtures,
// no DB — so it runs under plain `node --test` (no tsx needed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../", import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, repoRoot)), "utf8");

const dockerfile = read("Dockerfile");
const entrypoint = read("docker/ghcr-tiers/entrypoint.sh");
const workflow = read(".github/workflows/ghcr-tier-images.yml");
const compose = read("docker-compose.ghcr.yml");

describe("GHCR tier images — Dockerfile stage chain", () => {
  it("runner-web-cli builds on runner-cli (base + web + cli)", () => {
    assert.match(dockerfile, /^FROM runner-cli AS runner-web-cli$/m);
  });

  it("runner-web-cli-host builds on runner-web-cli (cumulative)", () => {
    assert.match(dockerfile, /^FROM runner-web-cli AS runner-web-cli-host$/m);
  });

  it("runner-full builds on runner-web-cli-host (cumulative)", () => {
    assert.match(dockerfile, /^FROM runner-web-cli-host AS runner-full$/m);
  });

  it("the host tier bakes the same env defaults as the compose host profile", () => {
    // Mirrors docker-compose.yml's `host` profile environment block.
    // assert.ok(boolean), not assert.match — a failing assert.match dumps the
    // whole Dockerfile into the report (same convention as
    // docker-build-memory-budget.test.ts).
    assert.ok(/^ENV CLI_MODE=host/m.test(dockerfile), "CLI_MODE=host must be baked");
    // The remaining three are continuation lines of the multi-line ENV, so no
    // line-start anchor.
    assert.ok(
      /CLI_EXTRA_PATHS=\/host-local\/bin:\/host-node\/bin/m.test(dockerfile),
      "CLI_EXTRA_PATHS must mirror the compose host profile"
    );
    assert.ok(/CLI_CONFIG_HOME=\/host-home/m.test(dockerfile), "CLI_CONFIG_HOME");
    assert.ok(/CLI_ALLOW_CONFIG_WRITES=true/m.test(dockerfile), "CLI_ALLOW_CONFIG_WRITES");
  });

  it("runner-full installs Chromium (PLAYWRIGHT_BROWSERS_PATH inherited by chain)", () => {
    // The chromium install lives in runner-web-cli; assert it stays above the
    // derived stages so the tiers stay cumulative.
    const webCliIdx = dockerfile.indexOf("AS runner-web-cli");
    const chromiumIdx = dockerfile.indexOf("playwright/cli.js install chromium", webCliIdx);
    const hostIdx = dockerfile.indexOf("AS runner-web-cli-host");
    const fullIdx = dockerfile.indexOf("AS runner-full");
    assert.ok(webCliIdx > -1 && hostIdx > webCliIdx && fullIdx > hostIdx, "stage order");
    assert.ok(chromiumIdx > webCliIdx && chromiumIdx < hostIdx, "chromium installed inside runner-web-cli");
  });
});

describe("GHCR tier images — role entrypoint", () => {
  it("exists and is referenced by the Dockerfile", () => {
    assert.ok(existsSync(fileURLToPath(new URL("docker/ghcr-tiers/entrypoint.sh", repoRoot))));
    assert.match(dockerfile, /COPY --chmod=755 docker\/ghcr-tiers\/entrypoint\.sh/m);
    assert.match(dockerfile, /^ENTRYPOINT \["\/app\/entrypoint\.sh"\]$/m);
  });

  it("delegates the default role to check-permissions.sh", () => {
    assert.match(entrypoint, /exec \/app\/check-permissions\.sh "\$@"/);
  });

  it("codex-app-server role mirrors the upstream compose command (token + app-server)", () => {
    assert.match(entrypoint, /OMNIROLE:-omniroute/);
    assert.match(entrypoint, /exec codex app-server/);
    assert.match(entrypoint, /--ws-auth capability-token/);
    assert.match(entrypoint, /--ws-token-file/);
    // Token minting fallback must exist (node crypto → /dev/urandom), same as
    // the docker-compose.yml codex-app-server profile command.
    assert.match(entrypoint, /randomBytes\(32\)/);
    assert.match(entrypoint, /\/dev\/urandom/);
  });
});

describe("GHCR tier images — workflow and compose wiring", () => {
  it("workflow builds all five tier targets + the browser sidecar", () => {
    for (const target of [
      "runner-base",
      "runner-web",
      "runner-web-cli",
      "runner-web-cli-host",
      "runner-full",
    ]) {
      assert.ok(workflow.includes(`target: ${target}`), `workflow must build ${target}`);
    }
    assert.ok(
      workflow.includes("docker/chatgpt-web-codex-browser/Dockerfile"),
      "workflow must build the browser sidecar"
    );
  });

  it("workflow and compose agree on the GHCR image name", () => {
    const image = "ghcr.io/rumman02/omniroute";
    assert.ok(workflow.includes(`GHCR_IMAGE: ${image}`));
    assert.ok(compose.includes(`image: ${image}:`));
  });

  it("tags every tier with a latest-<tier> channel; bare latest/version are base-only", () => {
    // Upstream convention: diegosouzapw/omniroute:latest == base flavor, and
    // flavored images get the -<flavor> suffix (latest-web, 3.8.51-web).
    assert.ok(
      /tags\+=\(-t "\$\{GHCR_IMAGE\}:latest-\$\{tier\}"\)/.test(workflow),
      "non-base tiers must publish a latest-<tier> tag"
    );
    assert.match(workflow, /tags\+=\(-t "\$\{GHCR_IMAGE\}:latest"\)/);
    // The bare :latest and :<version> aliases are inside the base branch only —
    // assert they appear after the base check, alongside each other.
    const latestIdx = workflow.indexOf('tags+=(-t "${GHCR_IMAGE}:latest")');
    const versionIdx = workflow.indexOf('tags+=(-t "${GHCR_IMAGE}:${VERSION}")');
    assert.ok(latestIdx > -1 && versionIdx > latestIdx, "bare version tag follows the bare latest tag in the base branch");
  });

  it("compose selects the tier via OMNIROUTE_TIER with base as default", () => {
    assert.match(compose, /image: ghcr\.io\/rumman02\/omniroute:\$\{OMNIROUTE_TIER:-base\}/);
  });

  it("compose's codex-app-server sidecar uses the full image in the sidecar role", () => {
    assert.match(compose, /image: ghcr\.io\/rumman02\/omniroute:full/);
    assert.match(compose, /- OMNIROLE=codex-app-server/);
    // The sidecar healthcheck probes /readyz on 1456 (the HTTP app's
    // healthcheck.mjs would be wrong for this role).
    assert.match(compose, /127\.0\.0\.1:1456\/readyz/);
  });

  it("compose has no build: sections (pre-built images only)", () => {
    assert.doesNotMatch(compose, /^\s{2,}build:/m);
  });
});

describe("GHCR tier images — upstream sync workflow", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, repoRoot)), "utf8");
  const syncWf = read(".github/workflows/ghcr-tier-sync.yml");

  it("exists, merges upstream diegosouzapw/OmniRoute into the tier branch", () => {
    assert.ok(existsSync(fileURLToPath(new URL(".github/workflows/ghcr-tier-sync.yml", repoRoot))));
    assert.ok(syncWf.includes("https://github.com/diegosouzapw/OmniRoute.git"));
    assert.ok(syncWf.includes("TIER_BRANCH: feat/ghcr-tier-images"));
    assert.match(syncWf, /git merge --no-edit/);
  });

  it("dispatches the tier build explicitly (GITHUB_TOKEN pushes don't trigger push-workflows)", () => {
    assert.match(syncWf, /gh workflow run ghcr-tier-images\.yml --ref "\$TIER_BRANCH"/);
  });

  it("opens an issue instead of failing silently on a merge conflict", () => {
    assert.match(syncWf, /changed == 'conflict'/);
    assert.match(syncWf, /gh issue create/);
  });
});

describe("GHCR tier images — examples", () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, repoRoot)), "utf8");

  it("standalone compose: zero-config, tier-selectable, no env_file dependency", () => {
    const standalone = read("docker/ghcr-tiers/examples/docker-compose.standalone.yml");
    assert.match(
      standalone,
      /image: ghcr\.io\/rumman02\/omniroute:\$\{OMNIROUTE_TIER:-base\}/
    );
    // The whole point of the standalone file: works without the repo's .env.
    assert.ok(!standalone.includes("env_file:"), "must not require env_file");
    // Sidecars behind profiles, same as the main compose file.
    assert.match(standalone, /- OMNIROLE=codex-app-server/);
    assert.match(standalone, /127\.0\.0\.1:1456\/readyz/);
    assert.match(standalone, /image: ghcr\.io\/rumman02\/omniroute:chatgpt-web-codex-browser/);
  });

  it("custom-tier Dockerfile builds on a published tier and returns to USER node", () => {
    const dockerfile = read("docker/ghcr-tiers/examples/custom-tier.Dockerfile");
    assert.match(dockerfile, /^FROM ghcr\.io\/rumman02\/omniroute:web-cli$/m);
    // Extending must end non-root, mirroring the parent stage's contract.
    const users = [...dockerfile.matchAll(/^USER (\S+)$/gm)].map((m) => m[1]);
    assert.equal(users[users.length - 1], "node");
  });
});
