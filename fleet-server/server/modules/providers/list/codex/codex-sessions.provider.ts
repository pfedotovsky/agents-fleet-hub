// Modified from CloudCLI 1.36.1 — see NOTICE.
import fsSync from 'node:fs';
import { createHash } from 'node:crypto';

import { sessionsDb } from '@/modules/database/index.js';
import { toImageAttachments } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, readJsonlLines, readObjectRecord, sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'codex';

// Read-only compatibility for sessions created by the removed SDK adapter,
// which persisted its plan instruction inside the user prompt. New app-server
// turns never add this preamble.
const CODEX_PLAN_PREAMBLE_SENTINEL = '--- USER REQUEST BELOW ---';

function stripCodexPlanPreamble(text: string): string {
  if (typeof text !== 'string' || !text.startsWith('[PLAN MODE')) {
    return text;
  }
  const idx = text.indexOf(CODEX_PLAN_PREAMBLE_SENTINEL);
  if (idx === -1) {
    return text;
  }
  return text.slice(idx + CODEX_PLAN_PREAMBLE_SENTINEL.length).replace(/^\s+/, '');
}

/**
 * Deterministic id for a persisted Codex entry. Codex rollout lines carry no
 * per-message uuid (unlike Claude), so falling back to a random id gave the
 * same message a fresh id on every read — defeating the hub's id-based
 * de-duplication and re-appending the whole transcript on each history
 * reconciliation. A content hash keyed on the identifying fields stays stable
 * across reads and unique across distinct messages.
 */
function stableCodexId(raw: AnyRecord, sessionId: string | null): string {
  if (typeof raw.uuid === 'string' && raw.uuid) {
    return raw.uuid;
  }
  const role = typeof raw.message?.role === 'string' ? raw.message.role : '';
  const content =
    typeof raw.message?.content === 'string'
      ? raw.message.content
      : JSON.stringify(raw.message?.content ?? raw.toolInput ?? raw.output ?? '');
  const key = [
    sessionId ?? '',
    raw.timestamp ?? '',
    raw.type ?? '',
    role,
    raw.toolCallId ?? '',
    content,
  ].join(' ');
  return `codex_${createHash('sha1').update(key).digest('hex')}`;
}

type CodexHistoryResult =
  | AnyRecord[]
  | {
      messages?: AnyRecord[];
      total?: number;
      hasMore?: boolean;
      offset?: number;
      limit?: number | null;
      tokenUsage?: unknown;
    };

function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

/**
 * Reads the image attachments Codex records on `user_message` events.
 * Turns sent with `local_image` input items land in `local_images` as file
 * paths (verified against real rollout JSONL); the `images` array can carry
 * base64 data URLs, which are passed through as inline `data` attachments so
 * the UI can preview them without a file lookup.
 *
 * Exported for tests.
 */
export function extractCodexUserImages(
  payload: AnyRecord | null | undefined,
): Array<{ path?: string; data?: string }> | undefined {
  if (!payload) {
    return undefined;
  }

  const candidates = [
    ...(Array.isArray(payload.local_images) ? payload.local_images : []),
    ...(Array.isArray(payload.images) ? payload.images : []),
  ];

  const attachments: Array<{ path?: string; data?: string }> = [];
  for (const entry of candidates) {
    if (typeof entry !== 'string' || !entry.trim()) {
      continue;
    }
    if (entry.startsWith('data:')) {
      attachments.push({ data: entry });
    } else {
      attachments.push(...toImageAttachments([entry]));
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

function extractCodexTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * App-server persists hosted web searches as `exec` custom-tool wrappers
 * around `tools.web__run`, not as rollout `web_search` items. Recover the
 * provider query conservatively without evaluating the recorded JavaScript so
 * history refreshes keep the native WebSearch row shown during the live turn.
 */
function extractAppServerWebSearchQuery(toolName: unknown, input: unknown): string | null {
  if (toolName !== 'exec' || typeof input !== 'string' || !input.includes('tools.web__run')) {
    return null;
  }

  const match = input.match(/(?:^|[,{]\s*)["']?q["']?\s*:\s*("(?:\\.|[^"\\])*")/);
  if (!match) return null;
  try {
    const query = JSON.parse(match[1]);
    return typeof query === 'string' && query.trim() ? query.trim() : null;
  } catch {
    return null;
  }
}

type StaticString = { value: string; end: number };

function readStaticString(source: string, start: number): StaticString | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character !== '\\') {
      value += character;
      continue;
    }
    index += 1;
    if (index >= source.length) return null;
    const escaped = source[index];
    const simpleEscapes: Record<string, string> = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '0': '\0',
      '\\': '\\',
      '"': '"',
      "'": "'",
    };
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped];
      continue;
    }
    if (escaped === 'u') {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }
    if (escaped === 'x') {
      const hex = source.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }
    value += escaped;
  }
  return null;
}

function findStaticPropertyValue(source: string, property: string): number | null {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const parsed = readStaticString(source, index);
      if (!parsed) return null;
      index = parsed.end - 1;
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      continue;
    }
    if (depth !== 1 || !/[A-Za-z_$]/.test(character)) continue;

    let end = index + 1;
    while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
    if (source.slice(index, end) !== property) {
      index = end - 1;
      continue;
    }
    let colon = end;
    while (/\s/.test(source[colon] ?? '')) colon += 1;
    if (source[colon] !== ':') {
      index = end - 1;
      continue;
    }
    let value = colon + 1;
    while (/\s/.test(source[value] ?? '')) value += 1;
    return value;
  }
  return null;
}

function readBalancedStaticValue(
  source: string,
  start: number,
  open: '[' | '{',
  close: ']' | '}',
): { value: string; end: number } | null {
  if (source[start] !== open) return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' || character === "'") {
      const parsed = readStaticString(source, index);
      if (!parsed) return null;
      index = parsed.end - 1;
      continue;
    }
    if (character === open) depth += 1;
    if (character !== close) continue;
    depth -= 1;
    if (depth === 0) return { value: source.slice(start, index + 1), end: index + 1 };
  }
  return null;
}

function extractStaticToolArguments(input: string, tool: string): string | null {
  const marker = `tools.${tool}`;
  let markerIndex = -1;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' || character === "'") {
      const parsed = readStaticString(input, index);
      if (!parsed) return null;
      index = parsed.end - 1;
      continue;
    }
    if (character === '`') {
      for (index += 1; index < input.length; index += 1) {
        if (input[index] === '\\') index += 1;
        else if (input[index] === '`') break;
      }
      continue;
    }
    if (
      input.startsWith(marker, index)
      && !/[A-Za-z0-9_$]/.test(input[index - 1] ?? '')
    ) {
      markerIndex = index;
      break;
    }
  }
  if (markerIndex < 0) return null;
  let open = markerIndex + marker.length;
  while (/\s/.test(input[open] ?? '')) open += 1;
  if (input[open] !== '(') return null;

  let depth = 1;
  for (let index = open + 1; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' || character === "'") {
      const parsed = readStaticString(input, index);
      if (!parsed) return null;
      index = parsed.end - 1;
      continue;
    }
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    depth -= 1;
    if (depth === 0) return input.slice(open + 1, index).trim();
  }
  return null;
}

type AppServerPlanWrapper = {
  explanation?: string;
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
};

/**
 * App-server persists Code Mode plan updates as JavaScript wrappers around a
 * static `tools.update_plan({...})` call. Parse only string literals and the
 * verified plan shape; never execute or import the recorded JavaScript.
 */
function extractAppServerPlanWrapper(toolName: unknown, input: unknown): AppServerPlanWrapper | null {
  if (toolName !== 'exec' || typeof input !== 'string') return null;
  const argumentsText = extractStaticToolArguments(input, 'update_plan');
  if (!argumentsText || argumentsText[0] !== '{') return null;
  const planStart = findStaticPropertyValue(argumentsText, 'plan');
  if (planStart === null) return null;
  const plan = readBalancedStaticValue(argumentsText, planStart, '[', ']');
  if (!plan) return null;

  const todos: AppServerPlanWrapper['todos'] = [];
  for (let index = 1; index < plan.value.length - 1; index += 1) {
    const character = plan.value[index];
    if (/\s|,/.test(character)) continue;
    const entry = readBalancedStaticValue(plan.value, index, '{', '}');
    if (!entry) return null;
    const stepStart = findStaticPropertyValue(entry.value, 'step');
    const statusStart = findStaticPropertyValue(entry.value, 'status');
    if (stepStart === null || statusStart === null) return null;
    const step = readStaticString(entry.value, stepStart);
    const status = readStaticString(entry.value, statusStart);
    if (!step?.value.trim() || !status) return null;
    if (
      status.value !== 'pending'
      && status.value !== 'in_progress'
      && status.value !== 'completed'
    ) return null;
    todos.push({ content: step.value, status: status.value });
    index = entry.end - 1;
  }
  if (todos.length === 0) return null;

  const explanationStart = findStaticPropertyValue(argumentsText, 'explanation');
  const explanation = explanationStart === null
    ? null
    : readStaticString(argumentsText, explanationStart)?.value.trim() || null;
  return {
    ...(explanation ? { explanation } : {}),
    todos,
  };
}

function extractAppServerCommandWrapper(toolName: unknown, input: unknown): string | null {
  if (toolName !== 'exec' || typeof input !== 'string') return null;
  const argumentsText = extractStaticToolArguments(input, 'exec_command');
  if (!argumentsText || argumentsText[0] !== '{') return null;
  const commandStart = findStaticPropertyValue(argumentsText, 'cmd');
  if (commandStart === null) return null;
  const command = readStaticString(argumentsText, commandStart)?.value;
  return command?.trim() ? command : null;
}

type AppServerMcpWrapper = {
  server: string;
  tool: string;
  argumentsText: string;
};

/**
 * App-server persists Code Mode MCP calls as `exec` wrappers around a static
 * `tools.mcp__<server>__<tool>(...)` reference. Recover only that verified
 * identifier and its inert argument source; never evaluate recorded code.
 */
function extractAppServerMcpWrapper(toolName: unknown, input: unknown): AppServerMcpWrapper | null {
  if (toolName !== 'exec' || typeof input !== 'string') return null;
  const match = /tools\.mcp__([A-Za-z0-9_]+)__([A-Za-z0-9_]+)\s*\(/.exec(input);
  if (!match) return null;

  let depth = 1;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = match.index + match[0].length; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    depth -= 1;
    if (depth === 0) {
      return {
        server: match[1],
        tool: match[2],
        argumentsText: input.slice(match.index + match[0].length, index).trim(),
      };
    }
  }
  return null;
}

const APP_SERVER_COLLABORATION_TOOLS = {
  spawn_agent: 'spawnAgent',
  send_input: 'sendInput',
  resume_agent: 'resumeAgent',
  wait_agent: 'wait',
  close_agent: 'closeAgent',
} as const;

function extractAppServerCollaboration(
  toolName: unknown,
  rawArguments: unknown,
): Record<string, unknown> | null {
  if (typeof toolName !== 'string' || !(toolName in APP_SERVER_COLLABORATION_TOOLS)) {
    return null;
  }
  const action = APP_SERVER_COLLABORATION_TOOLS[
    toolName as keyof typeof APP_SERVER_COLLABORATION_TOOLS
  ];
  let args: AnyRecord = {};
  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as AnyRecord;
      }
    } catch {
      // The action remains useful even when persisted arguments are malformed.
    }
  }

  return {
    action,
    taskName: typeof args.task_name === 'string' ? args.task_name : null,
    forkTurns: typeof args.fork_turns === 'string' ? args.fork_turns : null,
    target: typeof args.target === 'string' ? args.target : null,
    timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : null,
    model: typeof args.model === 'string' ? args.model : null,
    reasoningEffort: typeof args.reasoning_effort === 'string' ? args.reasoning_effort : null,
  };
}

function extractAppServerImageViewWrapper(toolName: unknown, input: unknown): string | null {
  if (toolName !== 'exec' || typeof input !== 'string' || !input.includes('tools.view_image')) {
    return null;
  }
  try {
    const match = input.match(
      /tools\.view_image\s*\(\s*\{[\s\S]*?["']?path["']?\s*:\s*("(?:\\.|[^"\\])*")/,
    );
    if (!match) return null;
    const imagePath = JSON.parse(match[1]);
    return typeof imagePath === 'string' && imagePath.trim() ? imagePath : null;
  } catch {
    return null;
  }
}

async function getCodexSessionMessages(
  sessionId: string,
  limit: number | null = null,
  offset = 0,
): Promise<CodexHistoryResult> {
  try {
    const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages: AnyRecord[] = [];
    let tokenUsage: AnyRecord | null = null;
    const appServerMcpCallIds = new Set<string>();
    const appServerImageViewCallIds = new Set<string>();
    const appServerPlanCallIds = new Set<string>();
    const appServerCodeModeCallIds = new Set<string>();
    const appServerPlanMessageIndexes = new Map<string, number>();
    for await (const line of readJsonlLines(sessionFilePath)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as AnyRecord;

        if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
          const info = entry.payload.info as AnyRecord;
          // [fork-fix #19] `total_token_usage` is cumulative across the whole
          // thread and can exceed the context window many times over. The UI
          // needs the latest turn's occupancy, which Codex records separately.
          if (info.last_token_usage) {
            const usage = info.last_token_usage as AnyRecord;
            tokenUsage = {
              used: usage.total_tokens || 0,
              total: info.model_context_window || 200000,
            };
          }
        }

        if (entry.type === 'compacted' && typeof entry.timestamp === 'string' && entry.timestamp) {
          messages.push({
            type: 'tool_use',
            timestamp: entry.timestamp,
            toolName: 'ContextCompaction',
            toolInput: {},
            toolCallId: `compaction_${entry.timestamp}`,
          });
        }

        if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload as AnyRecord)) {
          messages.push({
            type: 'user',
            timestamp: entry.timestamp,
            message: {
              role: 'user',
              content: stripCodexPlanPreamble(entry.payload.message),
            },
            images: extractCodexUserImages(entry.payload as AnyRecord),
          });
        }

        if (
          entry.type === 'response_item' &&
          entry.payload?.type === 'message' &&
          entry.payload.role === 'assistant'
        ) {
          const textContent = extractCodexTextContent(entry.payload.content);
          if (textContent.trim()) {
            messages.push({
              type: 'assistant',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: textContent,
              },
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'reasoning') {
          const summaryText = Array.isArray(entry.payload.summary)
            ? entry.payload.summary
                .map((item: AnyRecord) => item?.text)
                .filter(Boolean)
                .join('\n')
            : '';

          if (summaryText.trim()) {
            messages.push({
              type: 'thinking',
              timestamp: entry.timestamp,
              message: {
                role: 'assistant',
                content: summaryText,
              },
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
          let toolName = entry.payload.name;
          let toolInput = entry.payload.arguments;
          const collaboration = extractAppServerCollaboration(toolName, toolInput);

          if (collaboration) {
            toolName = 'Agent';
            toolInput = JSON.stringify(collaboration);
          } else if (toolName === 'shell_command') {
            toolName = 'Bash';
            try {
              const args = JSON.parse(entry.payload.arguments) as AnyRecord;
              toolInput = JSON.stringify({ command: args.command });
            } catch {
              // Keep original arguments when parsing fails.
            }
          }

          messages.push({
            type: 'tool_use',
            timestamp: entry.timestamp,
            toolName,
            toolInput,
            toolCallId: entry.payload.call_id,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output,
          });
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
          const toolName = entry.payload.name || 'custom_tool';
          const input = entry.payload.input || '';
          const webSearchQuery = extractAppServerWebSearchQuery(toolName, input);
          const mcpWrapper = extractAppServerMcpWrapper(toolName, input);
          const imageViewPath = extractAppServerImageViewWrapper(toolName, input);
          const planWrapper = extractAppServerPlanWrapper(toolName, input);
          const commandWrapper = extractAppServerCommandWrapper(toolName, input);

          if (planWrapper) {
            appServerPlanCallIds.add(entry.payload.call_id);
            const turnId = typeof entry.payload.internal_chat_message_metadata_passthrough?.turn_id === 'string'
              ? entry.payload.internal_chat_message_metadata_passthrough.turn_id
              : null;
            const planMessage = {
              type: 'tool_use',
              timestamp: entry.timestamp,
              ...(turnId ? { uuid: `codex_app_server_plan_${turnId}` } : {}),
              toolName: 'TodoWrite',
              toolInput: planWrapper,
              toolCallId: entry.payload.call_id,
            };
            if (turnId && appServerPlanMessageIndexes.has(turnId)) {
              messages[appServerPlanMessageIndexes.get(turnId)!] = planMessage;
            } else {
              if (turnId) appServerPlanMessageIndexes.set(turnId, messages.length);
              messages.push(planMessage);
            }
          } else if (commandWrapper) {
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'Bash',
              toolInput: { command: commandWrapper },
              toolCallId: entry.payload.call_id,
            });
          } else if (webSearchQuery) {
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'WebSearch',
              toolInput: { query: webSearchQuery },
              toolCallId: entry.payload.call_id,
            });
          } else if (imageViewPath) {
            appServerImageViewCallIds.add(entry.payload.call_id);
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'ViewImage',
              toolInput: { path: imageViewPath },
              toolCallId: entry.payload.call_id,
            });
          } else if (mcpWrapper) {
            appServerMcpCallIds.add(entry.payload.call_id);
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: mcpWrapper.tool,
              toolInput: mcpWrapper.argumentsText,
              toolCallId: entry.payload.call_id,
              server: mcpWrapper.server,
            });
          } else if (toolName === 'apply_patch') {
            const fileMatch = String(input).match(/\*\*\* Update File: (.+)/);
            const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';
            const lines = String(input).split('\n');
            const oldLines: string[] = [];
            const newLines: string[] = [];

            for (const lineContent of lines) {
              if (lineContent.startsWith('-') && !lineContent.startsWith('---')) {
                oldLines.push(lineContent.slice(1));
              } else if (lineContent.startsWith('+') && !lineContent.startsWith('+++')) {
                newLines.push(lineContent.slice(1));
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'Edit',
              toolInput: JSON.stringify({
                file_path: filePath,
                old_string: oldLines.join('\n'),
                new_string: newLines.join('\n'),
              }),
              toolCallId: entry.payload.call_id,
            });
          } else if (toolName === 'exec') {
            appServerCodeModeCallIds.add(entry.payload.call_id);
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: 'CodeMode',
              toolInput: {},
              toolCallId: entry.payload.call_id,
            });
          } else {
            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName,
              toolInput: input,
              toolCallId: entry.payload.call_id,
            });
          }
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
          if (
            appServerMcpCallIds.has(entry.payload.call_id)
            || appServerImageViewCallIds.has(entry.payload.call_id)
            || appServerPlanCallIds.has(entry.payload.call_id)
            || appServerCodeModeCallIds.has(entry.payload.call_id)
          ) continue;
          messages.push({
            type: 'tool_result',
            timestamp: entry.timestamp,
            toolCallId: entry.payload.call_id,
            output: entry.payload.output || '',
          });
        }
      } catch {
        // Skip malformed lines.
      }
    }

    messages.sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime(),
    );
    const total = messages.length;

    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage,
      };
    }

    return { messages, tokenUsage };
  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

export class CodexSessionsProvider implements IProviderSessions {
  /**
   * Normalizes a persisted Codex JSONL entry.
   */
  private normalizeHistoryEntry(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = stableCodexId(raw, sessionId);

    if (raw.type === 'thinking' || raw.isReasoning) {
      const thinkingContent = typeof raw.message?.content === 'string'
        ? raw.message.content
        : '';
      if (!thinkingContent.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: thinkingContent,
      })];
    }

    if (raw.message?.role === 'user') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : String(raw.message.content || '');
      const rawImages = Array.isArray(raw.images) && raw.images.length > 0 ? raw.images : undefined;
      if (!content.trim() && !rawImages) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content,
        images: rawImages,
      })];
    }

    if (raw.message?.role === 'assistant') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
              .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
              .filter(Boolean)
              .join('\n')
          : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
      })];
    }

    if (raw.type === 'tool_use' || raw.toolName) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName || 'Unknown',
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
        server: raw.server,
      })];
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: Boolean(raw.isError),
      })];
    }

    return [];
  }

  /** Normalizes the compact history shape produced by the rollout reader. */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }
    return this.normalizeHistoryEntry(raw, sessionId);
  }

  /**
   * Loads Codex JSONL history and keeps token usage metadata when projects.js
   * provides it.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let result: CodexHistoryResult;
    try {
      // Load full history first so `total` reflects frontend-normalized messages,
      // not raw JSONL records.
      result = await getCodexSessionMessages(sessionId, null, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CodexProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const rawMessages = Array.isArray(result) ? result : (result.messages || []);
    const tokenUsage = Array.isArray(result) ? undefined : result.tokenUsage;

    const normalized: NormalizedMessage[] = [];
    for (const raw of rawMessages) {
      normalized.push(...this.normalizeHistoryEntry(raw, sessionId));
    }

    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    let total = 0;
    for (const msg of normalized) {
      if (msg.kind !== 'tool_result') {
        total += 1;
      }
    }
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage,
    };
  }
}
