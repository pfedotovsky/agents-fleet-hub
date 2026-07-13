#!/bin/bash
# Stop hook: remind the agent to update docs/ after fleet-hub source changes.
# Blocks the stop at most once (stop_hook_active guard), and only when BOTH:
#   1) this session edited files under fleet-hub/ (checked via the transcript), and
#   2) something in fleet-hub is newer on disk than docs/changelog.md.
IN=$(cat)

# Already continuing because of this hook — never block twice (prevents loops).
[ "$(printf '%s' "$IN" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CHANGELOG="$ROOT/docs/changelog.md"
[ -f "$CHANGELOG" ] || exit 0

# 1) Did this session edit fleet-hub files? Fail open (allow stop) if the
#    transcript is unavailable — better silent than nagging on chat-only turns.
TRANSCRIPT=$(printf '%s' "$IN" | jq -r '.transcript_path // empty')
{ [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; } || exit 0
EDITED=$(jq -r '
  select(.message.content? != null)
  | .message.content[]?
  | select(.type == "tool_use" and (.name == "Edit" or .name == "Write" or .name == "NotebookEdit"))
  | .input.file_path // empty
' "$TRANSCRIPT" 2>/dev/null | grep -c "fleet-hub/")
[ "${EDITED:-0}" -eq 0 ] && exit 0

# 2) Docs already refreshed after the last source change? Then stop normally.
STALE=$(find "$ROOT/fleet-hub/src" "$ROOT/fleet-hub/package.json" "$ROOT/fleet-hub/vite.config.ts" \
  -type f -newer "$CHANGELOG" 2>/dev/null | head -1)
[ -z "$STALE" ] && exit 0

cat <<'JSON'
{"decision":"block","reason":"fleet-hub sources were modified this session but docs/changelog.md was not updated. Per AGENTS.md: add a changelog entry under today's date; update docs/architecture.md if module layout, data flow, or CloudCLI API usage changed; check fleet-hub/README.md still tells the truth. If the change was trivial (pure formatting), finish without editing docs."}
JSON
exit 0
