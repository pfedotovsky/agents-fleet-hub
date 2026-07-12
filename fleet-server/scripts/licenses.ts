// Generates THIRD-PARTY-NOTICES.md from the production dependency tree.
// `bun build --compile` embeds every dependency into the released binary, so
// their license texts must ship alongside it.
//
// Usage: bun run scripts/licenses.ts

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const OUTPUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');

type PackageInfo = {
  name: string;
  version: string;
  license: string;
  licenseText: string | null;
};

const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const productionRoots: string[] = Object.keys(rootPackage.dependencies ?? {});

const seen = new Map<string, PackageInfo>();

function readLicenseText(dir: string): string | null {
  for (const name of fs.readdirSync(dir)) {
    if (/^(licen[cs]e|copying)(\.|$)/i.test(name)) {
      const filePath = path.join(dir, name);
      if (fs.statSync(filePath).isFile()) {
        return fs.readFileSync(filePath, 'utf8').trim();
      }
    }
  }
  return null;
}

function resolvePackageDir(name: string, fromDir: string): string | null {
  // Walk nested node_modules first (npm/bun hoisting), then the top level.
  let current = fromDir;
  while (current.startsWith(ROOT)) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    current = path.dirname(current);
  }
  const top = path.join(NODE_MODULES, name);
  return fs.existsSync(path.join(top, 'package.json')) ? top : null;
}

function walk(name: string, fromDir: string): void {
  const dir = resolvePackageDir(name, fromDir);
  if (!dir) {
    console.warn(`[licenses] Could not resolve ${name}`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;

  seen.set(key, {
    name: pkg.name,
    version: pkg.version,
    license:
      typeof pkg.license === 'string'
        ? pkg.license
        : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l: any) => l.type).join(' OR ') : 'UNKNOWN'),
    licenseText: readLicenseText(dir),
  });

  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    walk(dep, dir);
  }
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
    // Optional deps may legitimately be absent on this platform.
    if (resolvePackageDir(dep, dir)) walk(dep, dir);
  }
}

for (const dep of productionRoots) {
  walk(dep, ROOT);
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const lines: string[] = [
  '# Third-party notices',
  '',
  'fleet-server binaries are built with `bun build --compile`, which embeds the',
  'following npm packages. Their licenses are reproduced below.',
  '',
  'fleet-server itself is a fork of the CloudCLI UI server',
  '(https://github.com/siteboon/claudecodeui), AGPL-3.0-or-later — see LICENSE',
  'and NOTICE.',
  '',
  '| Package | Version | License |',
  '| --- | --- | --- |',
  ...packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.license} |`),
  '',
  '---',
  '',
];

for (const pkg of packages) {
  lines.push(`## ${pkg.name}@${pkg.version} (${pkg.license})`, '');
  lines.push(pkg.licenseText ? '```\n' + pkg.licenseText + '\n```' : '_No license file shipped in the package; see the SPDX identifier above._');
  lines.push('');
}

fs.writeFileSync(OUTPUT, lines.join('\n'));
console.log(`Wrote ${OUTPUT} (${packages.length} packages)`);
