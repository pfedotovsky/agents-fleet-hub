import { CodexAppServerClient } from '../server/modules/providers/list/codex/codex-app-server-client.ts';

const client = new CodexAppServerClient();

try {
  const handshake = await client.start();
  console.log(JSON.stringify({
    ok: true,
    cliVersion: handshake.cliVersion.join('.'),
    protocolBaseline: handshake.protocolBaseline,
    userAgent: handshake.initialize.userAgent,
    platformFamily: handshake.initialize.platformFamily,
    platformOs: handshake.initialize.platformOs,
  }, null, 2));
} finally {
  client.stop();
}
