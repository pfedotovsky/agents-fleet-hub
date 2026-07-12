# Upstream provenance

`fleet-server` is a fork of the **server component** of CloudCLI UI
(upstream: [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui),
npm: `@cloudcli-ai/cloudcli`). The frontend was not forked — the client is
[`fleet-hub/`](../fleet-hub/) in this repository.

| | |
| --- | --- |
| Upstream package | `@cloudcli-ai/cloudcli` |
| Version vendored | **1.36.1** |
| Tarball | https://registry.npmjs.org/@cloudcli-ai/cloudcli/-/cloudcli-1.36.1.tgz |
| Tarball shasum (npm `dist.shasum`) | `9b4f32b5012825711d312fcb23a88f922f3dbcec` |
| Date vendored | 2026-07-12 |
| License | AGPL-3.0-or-later with Section 7 additional terms (see `LICENSE`, `NOTICE`) |

What was copied: upstream `server/` (TS + JS source, not the compiled
`dist-server/`), the top-level `shared/networkHosts.js` (as
`server/shared-root/networkHosts.js`), and `LICENSE`.

## Marking modifications

The git tag **`fleet-server-vendor-1.36.1`** points at the pristine copy.
Every local change is therefore visible with:

```bash
git diff fleet-server-vendor-1.36.1 -- fleet-server/server
```

Fork bug fixes are committed one-per-issue with a `[fork-fix #N]` prefix,
where `#N` references `../docs/cloudcli-server-issues.md`.

## Cherry-picking upstream changes

1. `npm pack @cloudcli-ai/cloudcli@<new-version>` into a scratch dir and
   extract it.
2. `npm pack @cloudcli-ai/cloudcli@1.36.1` (or the version recorded above)
   and extract it as the baseline.
3. `diff -ru <baseline>/package/server <new>/package/server` and review only
   hunks touching files that still exist in `fleet-server/server/` (roughly
   half of upstream was stripped — see the divergence table in `README.md`).
4. Apply relevant hunks manually; update the version/shasum/date in this file.
