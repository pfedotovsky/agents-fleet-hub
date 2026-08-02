import {
  runCodexAppServerConversation,
  type CodexAppServerConversationEvent,
} from '../server/modules/providers/list/codex/codex-app-server-conversation.ts';

let assistantText = '';
let tokenBudget: unknown = null;
const warnings: string[] = [];
let effectiveSettings: unknown = null;

const result = await runCodexAppServerConversation({
  cwd: process.cwd(),
  prompt: 'Reply exactly: agents-hub-app-server-turn-ok. Do not use tools.',
  permissionMode: 'plan',
  ephemeral: true,
}, {
  onEvent: (event: CodexAppServerConversationEvent) => {
    if (event.type === 'assistant_delta') assistantText += event.delta;
    else if (event.type === 'token_budget') tokenBudget = event.tokenBudget;
    else if (event.type === 'warning') warnings.push(event.message);
    else if (event.type === 'session') effectiveSettings = event.effectiveSettings;
  },
});

console.log(JSON.stringify({
  ok: result.status === 'completed',
  status: result.status,
  assistantText,
  emittedAssistantText: result.emittedAssistantText,
  effectiveSettings,
  tokenBudget,
  warnings,
  ephemeral: true,
}, null, 2));
