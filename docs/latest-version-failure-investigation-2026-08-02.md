# fleet-server 0.3.0 failure investigation (2026-08-02)

## Scope

Two new localhost sessions created through Agents Hub were checked end to end:
one Codex session completed with no assistant message, while one Claude session
remained in `working…` indefinitely. The hub itself rendered both states
correctly and reported no browser-console errors.

## Codex: incompatible shared models cache

The fleet-server 0.3.0 binary embeds `@openai/codex-sdk` / Codex CLI 0.144.1.
The native Codex desktop app on the same machine runs a 0.146.0 alpha build and
writes the shared `~/.codex/models_cache.json`.

The cache written by 0.146.0 identifies itself with `client_version: 0.146.0`.
Its model rows omit `supports_reasoning_summaries`, but the 0.144.1 CLI bundled
with fleet-server treats that field as required. A new Agents Hub turn therefore
exits before producing an assistant message with:

```text
failed to load models cache: missing field `supports_reasoning_summaries`
```

The resulting rollout contains a user message and `task_complete` with
`last_agent_message: null`, which explains the apparently silent completion in
the hub.

This is a cross-version cache collision, not a WebSocket or transcript-rendering
failure. Deleting the cache is only a temporary workaround because the desktop
app can recreate the newer schema.

**Applied fix (`[fork-fix #18]`).** `@openai/codex-sdk` is pinned at 0.146.0,
and `resolveCodexCliPath()` no longer accepts the first PATH hit blindly. An
explicit executable `CODEX_CLI_PATH` still wins; otherwise the server compares
the PATH binary with bundled CLIs in the macOS ChatGPT/Codex applications and
uses the newest numeric version. This matters in the compiled binary, where the
SDK's npm-vendored executable is not shipped. Live verification selected
`/Applications/ChatGPT.app/Contents/Resources/codex` (0.146) over the PATH
0.144.1 binary and the formerly silent session returned a normal assistant
message.

**Current status (2026-08-05).** The native app-server cutover removed
`@openai/codex-sdk` and its embedded CLI entirely. The newest-host-CLI selector
remains, and app-server now fails explicitly when that CLI does not match the
verified protocol baseline.

## Claude: outbound TCP connection never establishes

The Claude run remains active because the spawned Claude CLI process is still
alive. Its transcript contains the user message but no model response. Process
inspection shows its API connections stuck in `SYN_SENT` to port 443; the TCP
handshake never completes. That is a network reachability/routing failure below
the fleet-server protocol layer. Earlier server logs also contain Claude API
connection failures, consistent with the same class of problem.

The SDK does emit an initialization event before the network request stalls.
That detail matters: a literal no-*first*-event timeout disarms too early and
does not fix the observed hang.

**Applied fix (`[fork-fix #17]`).** fleet-server now keeps a 45-second startup
deadline armed across SDK-only initialization events. It disarms only when an
assistant event, stream delta, or terminal result proves that the provider has
started responding. On expiry the query is closed and the existing error path
emits both a visible connection/configuration message and terminal `complete`.
The bound is configurable with `CLAUDE_STARTUP_TIMEOUT_MS`; later long turns and
interactive waits remain unbounded. Live verification with a five-second bound
reproduced the unreachable API and confirmed the UI left `working…` and showed
the intended error after five seconds.

## Release engineering observation

The release tags did not contain a Bun lockfile. `fleet-server/package.json`
allowed runtime SDKs with caret ranges, so release builds could embed a
different SDK version without any source diff.

**Applied fix.** Runtime provider SDK versions are exact, `fleet-server/bun.lock`
is tracked, the release workflow pins Bun 1.3.14, and CI requires
`bun install --frozen-lockfile` with no fallback to a floating install.
