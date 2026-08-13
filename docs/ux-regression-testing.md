# Deterministic UX regression testing

The Hub's Playwright suite runs against a local synthetic fleet-server contract,
not a personal host. It is the reproducible browser layer for backlog issue #42.

## Run it

```bash
cd fleet-hub
npx playwright install chromium
npm run test:ux
```

Playwright starts both Vite and `tests/ux/fake-host.mjs`. The fake host serves a
small REST and WebSocket contract on port 4312. The initial journey connects
with a fixture-only token, opens a structured transcript, reloads the page, and
checks that the canonical user and assistant turns remain visible without
duplication. Console errors and unhandled page exceptions fail the run.

## Add a fixture or journey

- Put reusable payloads under `fleet-hub/tests/ux/fixtures/` and use obviously
  synthetic names, paths, prompts, tokens, timestamps, and output.
- Extend `fake-host.mjs` only with routes or socket frames required by an
  observable journey. Keep responses deterministic; do not call a real host.
- Prefer assertions on roles, accessible names, focus, and visible state.
  Screenshots are reserved for stable surfaces with a specific regression, not
  broad snapshots of every page.
- Test reload reconciliation whenever a journey changes persisted or streamed
  state. Failures should retain a Playwright trace for local diagnosis.

Never copy a real JWT, password, hostname, project path, transcript, prompt,
attachment, or personal identifier into this suite. Reduce a discovered defect
to its structural shape and rewrite all content before committing it.

## Regression intake and repair

Every confirmed defect must first have a minimal deterministic reproduction.
The existing backlog loop may then prepare a tested repair in an isolated
worktree. Automatically generated repair PRs remain drafts for human review;
this suite does not add another scheduler, merge, release, deploy, or touch a
real host.
