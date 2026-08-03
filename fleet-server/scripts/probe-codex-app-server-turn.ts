import {
  runCodexAppServerConversation,
  type CodexAppServerConversationEvent,
} from '../server/modules/providers/list/codex/codex-app-server-conversation.ts';
import { resolvePendingPermission } from '../server/shared/pending-permissions.ts';

let assistantText = '';
let tokenBudget: unknown = null;
const warnings: string[] = [];
const interactions: Array<{ toolName: string; input: unknown }> = [];
let effectiveSettings: unknown = null;
const denyCommand = process.argv.includes('--deny-command');

const result = await runCodexAppServerConversation({
  cwd: process.cwd(),
  prompt: denyCommand
    ? 'Use the shell tool to run exactly: touch /private/tmp/agents-hub-approval-probe-must-not-exist. Do not use another method. If permission is denied, say denied.'
    : 'Reply exactly: agents-hub-app-server-turn-ok. Do not use tools.',
  permissionMode: 'plan',
  ephemeral: true,
}, {
  onEvent: (event: CodexAppServerConversationEvent) => {
    if (event.type === 'assistant_delta') assistantText += event.delta;
    else if (event.type === 'token_budget') tokenBudget = event.tokenBudget;
    else if (event.type === 'warning') warnings.push(event.message);
    else if (event.type === 'session') effectiveSettings = event.effectiveSettings;
    else if (event.type === 'permission_request') {
      interactions.push({ toolName: event.toolName, input: event.input });
      resolvePendingPermission(event.requestId, { allow: false });
    }
  },
});

console.log(JSON.stringify({
  ok: result.status === 'completed' && (!denyCommand || interactions.length > 0),
  status: result.status,
  assistantText,
  emittedAssistantText: result.emittedAssistantText,
  effectiveSettings,
  tokenBudget,
  warnings,
  interactions,
  ephemeral: true,
}, null, 2));
