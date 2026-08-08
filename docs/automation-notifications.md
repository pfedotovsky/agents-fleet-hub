# Scheduled-loop notifications

## Current Codex behavior

As verified on 2026-08-08, standalone cron tasks in this Codex environment run
in Default mode. The interactive `request_user_input` tool is not available in
that mode, so a scheduled task cannot reliably create the native `AWAITING
INPUT` card. The loop must capability-detect the tool every run rather than
claiming that a native input request exists.

Codex automation notifications are enabled separately from the task prompt.
The Cycle 2 automation keeps its notification policy unmuted. Operating-system
delivery can still depend on the user's Codex and macOS notification settings,
so an app-visible task remains the durable fallback.

## Decision fallback

When a decision blocks the remaining cycle and the native input tool is absent,
the scheduled run must:

1. Persist one decision packet on the canonical issue and cycle ledger.
2. Rename its task to `AWAITING INPUT — <cycle> — <decision-id>`.
3. Pin and unarchive the task, verify its app-visible state, and record its task
   id and first-delivery timestamp in the durable checkpoint.
4. Pause only after those artifacts exist.
5. End normally with a final response beginning `AWAITING INPUT —
   <decision-id>` and containing the exact reply syntax.

The run must not remain in progress waiting for a reply, self-interrupt, or
archive the task. A normal final response is what allows the standard completed
task notification to fire. Once the decision is durably resolved, a later run
may unpin and archive that exact task.

## Failures and hard stops

A run that can report its own failure uses `FAILED — <cycle> — <short cause>`
as its task title, stays unarchived, and ends with the cause and exact next
action. A non-decision hard stop uses `CYCLE STOPPED — <cycle> — <reason>`.
Low-level failures that terminate before the agent can rename or finish the
task remain a Codex platform limitation; unmuted failed-run notifications are
the only available fallback for those failures.
