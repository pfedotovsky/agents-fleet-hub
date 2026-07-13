// fleet-server addition (no upstream counterpart).
//
// Guards the loopback addresses of the server's port and detects "loopback
// shadowing": on BSD-derived stacks (macOS) and Windows, a socket bound to a
// specific address (127.0.0.1:PORT) wins connections over a wildcard bind
// (0.0.0.0:PORT), without either bind failing. Editor port forwarding
// (Cursor / VS Code Remote auto-forward) exploits exactly this: it binds
// 127.0.0.1:PORT on the developer's machine to tunnel a remote server, and
// every local client silently starts talking to the remote instance instead
// of this one.
//
// Two defenses:
//  1. Extra listeners on 127.0.0.1 / ::1 sharing the main Express app, so the
//     specific-address slots are occupied and a later forwarder gets
//     EADDRINUSE (editors then relocate their forward to a free port).
//     On Linux a specific bind conflicts with our own wildcard, so these
//     guards are expected to fail there — which is fine, because on Linux the
//     wildcard alone already blocks foreign loopback binds.
//  2. A periodic self-probe of /health over loopback that compares the
//     reported instanceId with our own, catching forwards that were already
//     in place before startup (when even the guard bind loses the race).

import http from 'http';

const LOOPBACK_HOSTS = [
    { address: '127.0.0.1', probeUrl: (port) => `http://127.0.0.1:${port}/health` },
    { address: '::1', probeUrl: (port) => `http://[::1]:${port}/health` },
];

const FIRST_PROBE_DELAY_MS = 5_000;
const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;

/** Hosts for which the OS accepts additional specific-address binds on the same port. */
export function isWildcardHost(host) {
    return host === '0.0.0.0' || host === '::' || host === '*';
}

/**
 * Decides whether a /health payload came from a foreign server instance.
 * Payloads without an instanceId (older fleet-server, stock CloudCLI, or an
 * arbitrary service that happens to answer /health) also count as foreign.
 */
export function evaluateProbePayload(payload, ownInstanceId) {
    if (!payload || typeof payload !== 'object') {
        return { shadowed: true, foreign: { reason: 'non-JSON or empty /health response' } };
    }
    if (payload.instanceId === ownInstanceId) {
        return { shadowed: false };
    }
    return {
        shadowed: true,
        foreign: {
            instanceId: payload.instanceId ?? '(none)',
            version: payload.version ?? '(unknown)',
            hostname: payload.hostname ?? '(unknown)',
            dataDir: payload.dataDir ?? '(unknown)',
            pid: payload.pid ?? '(unknown)',
        },
    };
}

function formatShadowWarning(url, foreign) {
    return [
        `[WARN] Loopback shadowing detected: ${url} is answered by a DIFFERENT server instance`,
        `       (version: ${foreign.version ?? '?'}, hostname: ${foreign.hostname ?? '?'}, pid: ${foreign.pid ?? '?'}, dataDir: ${foreign.dataDir ?? '?'}${foreign.reason ? `, ${foreign.reason}` : ''}).`,
        '       Local clients connecting to localhost reach THAT server, not this one.',
        '       Likely cause: editor port forwarding (Cursor / VS Code Remote auto-forward)',
        '       or another instance bound to the loopback address.',
    ].join('\n');
}

/**
 * Starts the loopback guard listeners and the periodic self-probe.
 * Call after the main server is listening. Returns { close }.
 */
export function startLoopbackGuard({ app, mainServer, port, instanceId, log = console }) {
    const guards = [];

    for (const { address } of LOOPBACK_HOSTS) {
        const guard = http.createServer(app);
        // The websocket gateway is attached to the main server's upgrade
        // event; forward upgrades so chat/shell sockets work over loopback.
        guard.on('upgrade', (req, socket, head) => {
            mainServer.emit('upgrade', req, socket, head);
        });
        guard.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                // Linux: expected — our own wildcard already covers loopback
                // exclusively. macOS/Windows: something else holds the
                // address; the self-probe below will tell whether it is a
                // foreign instance.
                log.warn(`[WARN] Loopback guard could not bind ${address}:${port} (address in use). ` +
                    'If another process is forwarding this port, the self-probe will report it.');
            } else if (error.code !== 'EAFNOSUPPORT' && error.code !== 'EADDRNOTAVAIL') {
                // EAFNOSUPPORT/EADDRNOTAVAIL: no IPv6 loopback — irrelevant.
                log.warn(`[WARN] Loopback guard failed on ${address}:${port}:`, error.message);
            }
        });
        guard.listen(port, address, () => {
            guards.push(guard);
        });
    }

    // Probe both loopback families; warn on state changes only, so a
    // persistent shadow does not flood the log every minute.
    let lastShadowedUrl = null;

    async function probeOnce() {
        for (const { probeUrl } of LOOPBACK_HOSTS) {
            const url = probeUrl(port);
            let payload;
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
                payload = await res.json();
            } catch {
                continue; // family unavailable or transient failure — not evidence of shadowing
            }
            const verdict = evaluateProbePayload(payload, instanceId);
            if (verdict.shadowed) {
                if (lastShadowedUrl !== url) {
                    lastShadowedUrl = url;
                    log.error(formatShadowWarning(url, verdict.foreign));
                }
                return;
            }
        }
        if (lastShadowedUrl !== null) {
            log.warn(`[WARN] Loopback shadowing on port ${port} has cleared; localhost reaches this instance again.`);
            lastShadowedUrl = null;
        }
    }

    const firstProbe = setTimeout(() => void probeOnce(), FIRST_PROBE_DELAY_MS);
    const probeTimer = setInterval(() => void probeOnce(), PROBE_INTERVAL_MS);
    // Do not keep the process alive just for the guard.
    firstProbe.unref?.();
    probeTimer.unref?.();

    return {
        close() {
            clearTimeout(firstProbe);
            clearInterval(probeTimer);
            for (const guard of guards) guard.close();
        },
    };
}
