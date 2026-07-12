// [fork-fix #4/#5] Per-session chat option persistence — see schema.ts.

import { getConnection } from '@/modules/database/connection.js';

export type SessionSettings = {
  permissionMode: string | null;
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
};

type SessionSettingsRow = {
  permission_mode: string | null;
  allowed_tools: string | null;
  disallowed_tools: string | null;
  skip_permissions: number;
};

function parseTools(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export const sessionSettingsDb = {
  getSettings(sessionId: string): SessionSettings | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT permission_mode, allowed_tools, disallowed_tools, skip_permissions
         FROM session_settings WHERE session_id = ?`
      )
      .get(sessionId) as SessionSettingsRow | null | undefined;

    if (!row) return null;

    return {
      permissionMode: row.permission_mode,
      allowedTools: parseTools(row.allowed_tools),
      disallowedTools: parseTools(row.disallowed_tools),
      skipPermissions: Boolean(row.skip_permissions),
    };
  },

  saveSettings(sessionId: string, settings: SessionSettings): void {
    const db = getConnection();
    db.prepare(
      `
      INSERT INTO session_settings (session_id, permission_mode, allowed_tools, disallowed_tools, skip_permissions, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (session_id)
      DO UPDATE SET
        permission_mode = excluded.permission_mode,
        allowed_tools = excluded.allowed_tools,
        disallowed_tools = excluded.disallowed_tools,
        skip_permissions = excluded.skip_permissions,
        updated_at = excluded.updated_at
      `
    ).run(
      sessionId,
      settings.permissionMode,
      JSON.stringify(settings.allowedTools),
      JSON.stringify(settings.disallowedTools),
      settings.skipPermissions ? 1 : 0
    );
  },

  /** Durably records an "always allow" grant made mid-run (rememberEntry). */
  appendAllowedTool(sessionId: string, entry: string): void {
    const current = this.getSettings(sessionId) ?? {
      permissionMode: null,
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
    };

    if (!current.allowedTools.includes(entry)) {
      current.allowedTools.push(entry);
    }
    current.disallowedTools = current.disallowedTools.filter((tool) => tool !== entry);

    this.saveSettings(sessionId, current);
  },
};
