# Codex parity audit — 2026-08-04

Issue: private backlog [#7](https://github.com/pfedotovsky/agents-fleet-hub-backlog/issues/7)

This audit drove the current source Hub and fleet-server from `origin/main`
(`c627f22`) against the local Codex 0.146.0 app-server adapter. The adapter was
enabled only in an isolated development server and database; the released
default and SDK fallback were not changed.

## Result

The model catalog, reasoning-effort controls, and context occupancy are current
and accurate. Most rich Codex tool families retain their native presentation
after a reload. The audit's Code Mode plan and orchestration gap is now fixed:
persisted plan wrappers return as native checklists and generic internal
JavaScript is no longer mislabeled as Bash. Child-agent discovery is now also
fixed: spawned and guardian rollouts remain addressable by id without entering
ordinary top-level session lists.

## Model and effort truth

The source UI loaded seven models from the live app-server catalog rather than
from a hard-coded list:

| Model | Reasoning efforts | Inputs |
|---|---|---|
| `gpt-5.6-sol` (default) | low, medium, high, xhigh, max, ultra | text, image |
| `gpt-5.6-terra` | low, medium, high, xhigh, max, ultra | text, image |
| `gpt-5.6-luna` | low, medium, high, xhigh, max | text, image |
| `gpt-5.5` | low, medium, high, xhigh | text, image |
| `gpt-5.4` | low, medium, high, xhigh | text, image |
| `gpt-5.4-mini` | low, medium, high, xhigh | text, image |
| `gpt-5.3-codex-spark` | low, medium, high, xhigh | text |

The draft composer selected `GPT-5.6-Sol` and exposed exactly its six supported
effort levels. A sandboxed development launch initially showed the six-model
disk cache because that sandbox could not initialize Codex state under
`~/.codex`; an unsandboxed local app-server probe and normal-permission source
server both returned all seven models. That setup artifact is not a product
defect.

## Context-window truth

Fresh and reopened Codex sessions rendered exact latest-turn occupancy, not
cumulative thread usage. The focused probe showed `19k / 258k` with accessible
name `Codex latest context occupancy (7%)`; larger reopened sessions showed
`27k / 258k` and `41k / 258k`. The chip was stable across a full page reload.

## Tool and session rendering

| Surface | Live | After reload | Audit result |
|---|---:|---:|---|
| Command execution | Native Bash row | Native Bash row | Pass |
| File changes | Native diff row | Preserved by reconciliation | Pass |
| Web search | Native Search row | Native Search row | Pass |
| MCP calls | Server-labelled native rows | Server-labelled native rows | Pass |
| Collaboration spawn/wait | Native Agent rows | Native Agent rows | Pass |
| Image view | Native View image row | Native View image row | Pass |
| Context compaction | Native passive row | Native passive row | Pass |
| `update_plan` | Native Todo list | Native Todo list | Fixed in [#40](https://github.com/pfedotovsky/agents-fleet-hub-backlog/issues/40) |
| Generic Code Mode orchestration | Compact Code Mode row | Compact Code Mode row; raw JavaScript/output absent | Fixed in [#40](https://github.com/pfedotovsky/agents-fleet-hub-backlog/issues/40) |
| Child-agent discovery | Parent activity is visible | Child remains addressable by id but is absent from top-level lists | Fixed in [#41](https://github.com/pfedotovsky/agents-fleet-hub-backlog/issues/41) |

The focused plan probe used native session
`cb659f4d-ce70-43cb-b700-0d6e2f464e8b`. The fix conservatively parses the
persisted static `tools.update_plan({...})` wrapper without evaluating it,
collapses repeated updates in one turn, and restores the same completed
two-item checklist after a clean server restart and full page reload. A
separate MCP session confirmed that unrecognized internal Code Mode JavaScript
renders as a compact orchestration row with its opaque output suppressed, while
the following MCP calls remain server-labelled native rows. The collapsed
`thinking…` row in the plan probe expanded to a real provider summary
(`Finalizing update plan`); empty reasoning summaries are already filtered and
were not a product defect.

The child-session finding is metadata-verifiable, not title-based. Parent
`019fc7b5-f68c-7140-8352-b3dbf3fee439` spawned child
`019fc7b6-1785-7370-b07e-ef1783103d5a`; the child rollout records
`thread_source: "subagent"`, the parent thread id, and the agent path, but the
Hub previously indexed it as a normal top-level session. The synchronizer now
persists the rollout relationship explicitly, filters child rows from normal
project/feed/search discovery and watcher upserts, and retains direct history
access by session id. Guardian/internal rollouts are covered by the same
`thread_source` contract.

## Next boundary

#40 and #41 are now fixed in current source. The Cycle 2 cutover makes
app-server the only Codex runtime and removes the SDK implementation and
dependency after local verification. SSH-host verification remains a separate
gate under backlog #37 and requires a named, explicitly authorized host; no
remote host was touched by this audit or cutover.
