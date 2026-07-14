// Builds fleet-server single-file executables with `bun build --compile`.
//
// Usage:
//   bun run scripts/build.ts                 # host platform only
//   bun run scripts/build.ts --all           # full release matrix
//   bun run scripts/build.ts --version 0.1.0
//
// Artifacts land in dist/: one binary per target plus a .tar.gz containing
// the binary, LICENSE, NOTICE, and THIRD-PARTY-NOTICES.md (bun compile embeds
// all npm dependencies into the binary, so their notices must ship with it).

import { $ } from 'bun';
import fs from 'node:fs';
import path from 'node:path';
import { generateHubAssets } from './generate-hub-assets.ts';

const ROOT = path.resolve(import.meta.dir, '..');
const DIST = path.join(ROOT, 'dist');

const RELEASE_TARGETS = ['bun-darwin-arm64', 'bun-linux-x64', 'bun-linux-arm64'];

const args = process.argv.slice(2);
const all = args.includes('--all');
const versionFlagIndex = args.indexOf('--version');
const version =
  versionFlagIndex !== -1
    ? args[versionFlagIndex + 1]
    : JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

if (!version) {
  console.error('No version — pass --version x.y.z or set it in package.json');
  process.exit(1);
}

const hostTarget = `bun-${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const targets = all ? RELEASE_TARGETS : [hostTarget];

fs.mkdirSync(DIST, { recursive: true });

// Embed the Agents Hub web UI so every compiled binary serves it at /fleet-hub.
console.log('\n▶ Embedding Agents Hub web UI');
generateHubAssets(path.resolve(ROOT, '../fleet-hub/dist'));

for (const target of targets) {
  const shortTarget = target.replace(/^bun-/, '');
  const binaryName = `fleet-server-${shortTarget}`;
  const outfile = path.join(DIST, binaryName);

  console.log(`\n▶ Building ${binaryName} (v${version})`);
  await $`bun build --compile --minify --target=${target} --define BUILD_VERSION='"${version}"' ${path.join(
    ROOT,
    'server/cli.js'
  )} --outfile ${outfile}`.cwd(ROOT);

  const stageDir = path.join(DIST, `stage-${shortTarget}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.copyFileSync(outfile, path.join(stageDir, 'fleet-server'));
  fs.chmodSync(path.join(stageDir, 'fleet-server'), 0o755);
  for (const doc of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'README.md']) {
    const source = path.join(ROOT, doc);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(stageDir, doc));
    }
  }

  const tarball = path.join(DIST, `fleet-server-${version}-${shortTarget}.tar.gz`);
  await $`tar -czf ${tarball} -C ${stageDir} .`;
  fs.rmSync(stageDir, { recursive: true, force: true });

  const sha = new Bun.CryptoHasher('sha256')
    .update(await Bun.file(tarball).arrayBuffer())
    .digest('hex');
  fs.writeFileSync(`${tarball}.sha256`, `${sha}  ${path.basename(tarball)}\n`);
  console.log(`  ${path.basename(tarball)}  sha256=${sha}`);
}

console.log('\nDone. Artifacts in dist/');
