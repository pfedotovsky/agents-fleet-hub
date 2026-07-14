// Serves the Agents Hub web UI under /fleet-hub.
//
// The compiled single binary carries the UI as Bun-embedded files listed in
// hub-assets.generated.js (produced by scripts/generate-hub-assets.ts before
// `bun build --compile`). In dev (`bun run server/index.js`) that manifest is
// usually empty/absent, so we fall back to reading fleet-hub/dist off disk.
//
// This is deliberately isolated from the API surface: the UI lives entirely
// under /fleet-hub, the API stays under /api, and "/" keeps its landing page.

import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import mime from 'mime-types';

export const HUB_BASE_PATH = '/fleet-hub';

// fleet-hub/dist relative to this file (server/), used only when nothing was
// embedded — i.e. running from source during development.
const DEV_HUB_DIST = path.resolve(import.meta.dir, '../../fleet-hub/dist');

function contentTypeFor(sub) {
    return mime.contentType(path.basename(sub)) || 'application/octet-stream';
}

// Returns { available, lookup(sub) } where lookup yields { contentType, load() }
// or null. Embedded manifest wins; otherwise the on-disk dev build.
async function resolveAssets() {
    let embedded = null;
    try {
        const mod = await import('./hub-assets.generated.js');
        if (mod?.HUB_ASSETS && Object.keys(mod.HUB_ASSETS).length > 0) {
            embedded = mod.HUB_ASSETS;
        }
    } catch {
        // No manifest bundled (dev) — fall through to disk.
    }

    if (embedded) {
        return {
            available: true,
            source: 'embedded',
            lookup(sub) {
                const ref = embedded[sub];
                if (!ref) return null;
                return {
                    contentType: contentTypeFor(sub),
                    load: async () => Buffer.from(await Bun.file(ref).arrayBuffer()),
                };
            },
        };
    }

    const hasDisk = fs.existsSync(path.join(DEV_HUB_DIST, 'index.html'));
    return {
        available: hasDisk,
        source: hasDisk ? 'disk' : 'none',
        lookup(sub) {
            const resolved = path.resolve(DEV_HUB_DIST, sub);
            // Refuse anything that escapes the dist root.
            if (resolved !== DEV_HUB_DIST && !resolved.startsWith(DEV_HUB_DIST + path.sep)) {
                return null;
            }
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
            return {
                contentType: contentTypeFor(sub),
                load: async () => fsPromises.readFile(resolved),
            };
        },
    };
}

// Registers the /fleet-hub routes on the given Express app. Must be called at
// module-eval time, before any catch-all route ("*"), so the sub-path is
// matched first. Asset resolution is async, so handlers await it; the returned
// promise resolves to a summary used for the startup log.
export function mountHub(app) {
    const ready = resolveAssets();

    // /fleet-hub -> /fleet-hub/ so the UI's relative asset URLs (base './')
    // resolve under the sub-path instead of the site root. Guard on the exact
    // path: non-strict routing also matches "/fleet-hub/" here, which would
    // otherwise redirect to itself forever — let that fall through instead.
    app.get(HUB_BASE_PATH, (req, res, next) => {
        if (req.path !== HUB_BASE_PATH) return next();
        res.redirect(308, `${HUB_BASE_PATH}/`);
    });

    app.get(`${HUB_BASE_PATH}/*`, async (req, res) => {
        const assets = await ready;
        if (!assets.available) {
            return res
                .status(503)
                .type('text/plain')
                .send('Agents Hub web UI is not bundled in this build.');
        }

        let sub = decodeURIComponent(req.path.slice(`${HUB_BASE_PATH}/`.length));
        if (sub === '') sub = 'index.html';

        let entry = assets.lookup(sub);
        // SPA-style fallback: unknown extensionless paths get index.html so
        // future client-side routes keep working; asset misses stay 404.
        if (!entry && !path.extname(sub)) entry = assets.lookup('index.html');
        if (!entry) return res.status(404).type('text/plain').send('Not found');

        try {
            const body = await entry.load();
            res.type(entry.contentType);
            if (sub.startsWith('assets/')) {
                // Vite fingerprints these filenames, so they're safe to pin.
                res.set('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                res.set('Cache-Control', 'no-cache');
            }
            res.send(body);
        } catch (error) {
            res.status(500).type('text/plain').send('Failed to read UI asset');
            console.error('[fleet-hub] Failed to serve asset:', error?.message || error);
        }
    });

    return ready;
}
