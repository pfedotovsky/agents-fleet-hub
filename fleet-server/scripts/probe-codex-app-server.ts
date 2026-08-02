import { CodexAppServerClient } from '../server/modules/providers/list/codex/codex-app-server-client.ts';
import {
  buildCodexAppServerModelsDefinition,
  listCodexAppServerModels,
} from '../server/modules/providers/list/codex/codex-models.provider.ts';

const client = new CodexAppServerClient();

try {
  const handshake = await client.start();
  const models = buildCodexAppServerModelsDefinition(
    await listCodexAppServerModels(client),
  );
  console.log(JSON.stringify({
    ok: true,
    cliVersion: handshake.cliVersion.join('.'),
    protocolBaseline: handshake.protocolBaseline,
    userAgent: handshake.initialize.userAgent,
    platformFamily: handshake.initialize.platformFamily,
    platformOs: handshake.initialize.platformOs,
    modelCount: models.OPTIONS.length,
    defaultModel: models.DEFAULT,
    models: models.OPTIONS.map((model) => ({
      value: model.value,
      label: model.label,
      effort: model.effort,
      inputModalities: model.inputModalities,
    })),
  }, null, 2));
} finally {
  client.stop();
}
