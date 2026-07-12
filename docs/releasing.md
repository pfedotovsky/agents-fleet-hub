# Releasing

How to cut a release of **Agents Hub** (the Tauri desktop app in `fleet-hub/`)
and **fleet-server** (the single-binary host server in `fleet-server/`). They
version and release independently; a change touching both ships as two tags.

Releases are cut **from `main`**. Tags drive everything: pushing a tag triggers
the matching GitHub Actions workflow, which builds the artifacts and publishes a
GitHub Release. The Homebrew tap (`pfedotovsky/homebrew-tap`) is then bumped
**by hand** — nothing auto-updates it — because the cask/formula need the
sha256 of the freshly built artifacts.

- **Hub:** `.github/workflows/release.yml`, trigger `v*`, builds the universal
  macOS `.dmg` + Linux `.AppImage/.deb/.rpm` via `tauri-action`.
- **Server:** `.github/workflows/server-release.yml`, trigger `server-v*`,
  typechecks + tests, then `bun run scripts/build.ts --all` cross-compiles the
  three tarballs (`darwin-arm64`, `linux-x64`, `linux-arm64`) + `.sha256` files.

Current published versions live in the tap and in `docs/changelog.md`. Pick the
next number by semver-ish patch bump unless the change warrants more (the cadence
so far has been all patch bumps).

---

## 1. Bump versions on `main`

Do the docs upkeep first (`docs/changelog.md` entry under today's date, plus
`architecture.md`/README if they changed), then bump every version string. Keep
the two products' numbers independent.

**Hub → `X.Y.Z`** (4 files):
- `fleet-hub/package.json` — `"version"`
- `fleet-hub/package-lock.json` — the top-level `"version"` **and** `packages[""]."version"`
- `fleet-hub/src-tauri/tauri.conf.json` — `"version"`
- `fleet-hub/src-tauri/Cargo.toml` — `version` under `[package]`

  (No `Cargo.lock` is tracked — CI regenerates it. Don't hand-edit one.)

**Server → `A.B.C`** (1 file):
- `fleet-server/package.json` — `"version"`

Sanity-check both build before committing:

```sh
(cd fleet-hub && npx tsc -b)
(cd fleet-server && bun x tsc --noEmit -p server/tsconfig.json)
```

Commit and push to `main`:

```sh
git add -A
git commit -m "Release: Agents Hub X.Y.Z + fleet-server A.B.C"   # scope to whatever actually shipped
git push origin main
```

## 2. Tag and push (triggers CI)

Only tag the products that changed. Tag names must be exactly `vX.Y.Z` /
`server-vA.B.C` (the workflows derive the version from the tag).

```sh
git tag -a vX.Y.Z       -m "Agents Hub X.Y.Z"
git tag -a server-vA.B.C -m "fleet-server A.B.C"
git push origin vX.Y.Z server-vA.B.C
```

Watch the runs (Tauri build ≈ 10–15 min; server build ≈ 2–4 min):

```sh
gh run list --limit 5 --json name,headBranch,status,conclusion \
  -q '.[] | "\(.name) [\(.headBranch)]: \(.status)/\(.conclusion // "-")"'
```

## 3. Bump the Homebrew tap (after CI succeeds)

The tap repo isn't cloned here; edit it through the GitHub contents API. Always
compute the sha256 from the **downloaded artifact** (don't trust the release's
`.sha256` sidecar blindly — though they should match).

**Formula — `Formula/fleet-server.rb`** (3 hashes):

```sh
gh release download server-vA.B.C -R pfedotovsky/agents-fleet-hub -p '*.tar.gz' -D /tmp/fs --clobber
(cd /tmp/fs && shasum -a 256 *.tar.gz)
```

Map them: `darwin-arm64` → `on_macos/on_arm`, `linux-x64` → `on_linux/on_intel`,
`linux-arm64` → `on_linux/on_arm`. Update `version` and the three `sha256`s.

**Cask — `Casks/agents-hub.rb`** (1 hash):

```sh
gh release download vX.Y.Z -R pfedotovsky/agents-fleet-hub -p '*universal.dmg' -D /tmp/hub --clobber
shasum -a 256 /tmp/hub/*.dmg
```

Update `version` and `sha256` (the `url` is templated on `#{version}`, so it
follows automatically — asset name is `Agents.Hub_<version>_universal.dmg`).

Push each edited file back (the contents API needs the current blob `sha`):

```sh
# after writing the new file to /tmp/<name>
SHA=$(gh api repos/pfedotovsky/homebrew-tap/contents/<path> -q '.sha')
gh api -X PUT repos/pfedotovsky/homebrew-tap/contents/<path> \
  -f message="<name> <version>" -f sha="$SHA" -f content="$(base64 -i /tmp/<name>)"
```

## 4. Verify

```sh
brew update
brew fetch --cask pfedotovsky/homebrew-tap/agents-hub   # ✔︎ = dmg sha256 matches
brew fetch       pfedotovsky/homebrew-tap/fleet-server  # ✔︎ = this platform's tarball matches
brew info --cask pfedotovsky/homebrew-tap/agents-hub | head -2
brew info        pfedotovsky/homebrew-tap/fleet-server  | head -2   # shows "old → stable new"
```

Then record the tags + cask/formula bump in `docs/changelog.md` under a
**Released** heading (see prior entries), if you didn't already in step 1.

---

## Gotchas

- **Empty Apple signing secrets.** `release.yml` only exports the `APPLE_*` env
  vars when the secrets are non-empty — Tauri treats a set-but-empty
  `APPLE_CERTIFICATE` as "please sign" and fails. Leave the secrets unset (not
  blank) until real notarization is wired up. The app currently ships
  **unnotarized**; the cask's caveats tell users to clear the quarantine flag.
- **Server upgrades need a restart.** `brew upgrade fleet-server` replaces the
  binary but the running service keeps the old one until
  `brew services restart fleet-server`. Say so in the changelog when a
  server-behavior fix ships (users won't see the fix otherwise).
- **Independent versions.** Don't bump the server just because the hub changed
  (or vice-versa). The previous release left the server untagged for exactly
  this reason — only tag what changed.
- **Transient asset-download TLS timeouts** from `gh release download` are
  common here; just retry the download.
