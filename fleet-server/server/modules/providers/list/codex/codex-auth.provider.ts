import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';
import { resolveCodexCliPath } from '@/shared/codex-cli-path.js';

/**
 * [fork-fix #13] Resolve the SAME binary and home dir the send path uses.
 * `queryCodex` spawns the binary from `resolveCodexCliPath()` (CODEX_CLI_PATH
 * then PATH) and reads auth from `$CODEX_HOME`. The auth check used to spawn a
 * bare `codex` (PATH only) and read a hardcoded `~/.codex/auth.json`, so when
 * codex was reachable only via CODEX_CLI_PATH (launchd's minimal PATH) or the
 * login lived under a custom CODEX_HOME, sends worked but the status endpoint
 * reported `authenticated: false` — a false "run `codex login`" banner.
 */
function codexBinary(): string {
  return resolveCodexCliPath() ?? 'codex';
}

function codexHomeDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    // A resolved path already proves the binary exists (CODEX_CLI_PATH via
    // existsSync, or PATH via X_OK); only probe as a last resort.
    if (resolveCodexCliPath()) return true;
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
   *
   * [fork-fix #13] Codex CLI >= 0.144 stores credentials in the OS keychain
   * by default and never writes auth.json, so a missing/tokenless file no
   * longer means "not logged in". Reading the keychain item directly would
   * trigger a macOS GUI permission dialog (the item's ACL matches OpenAI's
   * code signature), so fall back to `codex login status` (exit 0 = logged
   * in), which any codex binary can answer silently
   * (siteboon/claudecodeui#1008).
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    try {
      const authPath = path.join(codexHomeDir(), 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return this.checkCredentialsViaCli('No valid tokens found');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return this.checkCredentialsViaCli(
        code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth'
      );
    }
  }

  /**
   * [fork-fix #13] Keychain-backed logins are only visible through the CLI.
   *
   * [fork-fix #13] Don't trust the exit code alone. Some environments
   * (launchd-spawned service, first keychain unlock) have `codex login status`
   * print "Logged in using ChatGPT" while still exiting non-zero, which used to
   * surface a false "run `codex login`" banner even though sends work. Treat a
   * "logged in" line in stdout/stderr as authenticated too, and log the real
   * status/error so a genuine failure stays diagnosable. Timeout is generous
   * because the first keychain read under a service can be slow.
   */
  private checkCredentialsViaCli(fallbackError: string): CodexCredentialsStatus {
    try {
      const result = spawn.sync(codexBinary(), ['login', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15000,
        encoding: 'utf8',
      });

      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      const loggedIn = result.status === 0 || /logged in/i.test(output);

      if (loggedIn) {
        const emailMatch = output.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        return {
          authenticated: true,
          email: emailMatch ? emailMatch[0] : 'Authenticated',
          method: 'cli_status',
        };
      }

      console.warn(
        `[codex-auth] 'login status' reported not-authenticated (exit=${result.status}, ` +
          `signal=${result.signal ?? 'none'}, bin=${codexBinary()})` +
          (output ? `: ${output.replace(/\s+/g, ' ').slice(0, 200)}` : '')
      );
    } catch (error) {
      console.warn(
        `[codex-auth] 'login status' could not run (bin=${codexBinary()}): ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    return { authenticated: false, email: null, method: null, error: fallbackError };
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
        return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
      }
    } catch {
      // Fall back to a generic authenticated marker if the token payload is not readable.
    }

    return 'Authenticated';
  }
}
