// Modified from CloudCLI 1.36.1 — see NOTICE.
// Version is baked in at compile time via `bun build --define BUILD_VERSION='"x.y.z"'`;
// interpreted dev runs fall back to 'dev'. This replaces upstream's runtime
// package.json lookup (utils/runtime-paths.js findAppRoot), which cannot work
// inside a compiled single-file binary.

declare const BUILD_VERSION: string | undefined;

export const VERSION: string =
  typeof BUILD_VERSION !== 'undefined' && BUILD_VERSION ? BUILD_VERSION : 'dev';

export const PRODUCT_NAME = 'fleet-server';

export const UPSTREAM_ATTRIBUTION =
  'Based on CloudCLI UI (https://github.com/siteboon/claudecodeui)';
