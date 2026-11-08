# S2-C: `npm ci --ignore-scripts` through the sandbox and the allowlist proxy

Plan 02-06 Task 3. Tests RESEARCH assumption A1 (npm 11 honours `npm_config_https_proxy` for CONNECT) for decision D-11 (a supervisor step reaches only the registry).

A1: confirmed

## What was run

Reproducer: `AVARICE_NET=1 node --test test/containment/npm-ci-proxy.test.ts` (skipped without `AVARICE_NET`; `AVARICE_S2C_REPO` names the checkout, default `$HOME/aa-phan-portfolio-v2`; `AVARICE_S2C_REPORT` writes the evidence JSON).

1. `git clone --no-hardlinks ~/aa-phan-portfolio-v2` into a temp directory, then `git checkout --detach 9f1cd8d`. The owner's checkout is only read.
2. Lockfile audit of `package-lock.json` at the pin.
3. `startAllowlistProxy({ allow: ['registry.npmjs.org:443'] })`: node:http and node:net, 127.0.0.1, ephemeral port.
4. `npm ci --ignore-scripts --no-audit --no-fund` under `SandboxedExecutor`, cwd the clone, `allowLoopbackPorts: [<proxy port>]`, `writePaths: [clone/node_modules, <tmp>]`, `denyReadPaths: [~/.ssh, ~/.aws, ~/.config/gh]`. Environment only: `PATH`, `HOME` and `TMPDIR` and `npm_config_cache` under the temp directory, `npm_config_https_proxy` and `npm_config_proxy` set to `http://127.0.0.1:<port>`, `npm_config_update_notifier=false`, `CI=1`.

## Result

| Item | Value |
|------|-------|
| Date | 2026-11-05 |
| Node, npm | v26.9.0, 11.19.1 |
| Command status | passed, exit code 0, no signal, empty stderr |
| npm output | `added 146 packages in 2s` (second run: 1s; cache directory empty each run) |
| Wall time inside the executor | 1.98 s (second run 1.64 s) |
| `node_modules` size | 271272 KiB (about 265 MiB) |
| `node_modules/.package-lock.json` | present |
| Proxy attempts | 15 CONNECT to `registry.npmjs.org:443`, all allowed; no refused attempt, no other host |
| Lockfile `resolved` hosts | `registry.npmjs.org`: 244 entries; no other host, no entry without a `resolved` URL |

The proxy saw only the registry, and npm used it: with the Seatbelt profile allowing nothing but that one loopback port, a successful install proves npm sent its traffic through the proxy.

## Controls (same file, second test)

| Control | Observation |
|---------|-------------|
| `curl --noproxy '*' https://registry.npmjs.org/` under the same sandbox and the same allowed port | non-zero exit; the proxy recorded no attempt (Seatbelt denies the direct route) |
| `curl -x http://127.0.0.1:<port> https://example.com/` | non-zero exit; the proxy recorded exactly one attempt, `example.com:443`, refused (403) |

## The owner's checkout

`git status --porcelain` and `git rev-parse HEAD` of `~/aa-phan-portfolio-v2`, read by the test before the clone and after the install:

- before: `?? .env`, HEAD `9f1cd8d51f83252ad11a8c486c4245b1b9fc3066`
- after: `?? .env`, HEAD `9f1cd8d51f83252ad11a8c486c4245b1b9fc3066`

Identical; the test asserts equality. (The untracked `.env` is the known Phase 1 finding; it is not read or copied, because a clone carries tracked content only.)

## Verdict and consequences

- A1: confirmed. npm 11.19.1 honours `npm_config_https_proxy` for CONNECT, so no widening of the Seatbelt profile (`*:443`) and no offline-cache fallback is needed for D-11.
- Plan 02-14's install step can be built on `allowLoopbackPorts` plus `startAllowlistProxy` as designed; its allowlist for a project comes from the project's lockfile hosts (this lockfile: registry only).
- Not tested here: a lockfile with a non-registry `resolved` host (git or tarball URL) fails the audit by design and would need an owner decision; a project whose install needs `postinstall` scripts (`--ignore-scripts` skips them).
- Residual: the proxy resolves and connects to `registry.npmjs.org:443` from AVARICE's own process, outside the sandbox; the allowlist is the control, and DNS for that name is trusted (T-02-17 accepted).
