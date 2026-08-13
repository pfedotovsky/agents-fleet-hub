# Deterministic UX regression checks

The Hub's Playwright checks run against a deterministic localhost fleet-server replay,
not a personal host. The first journey covers loopback-style token minting,
authenticated REST polling, WebSocket subscription, keyboard opening of a
session, structured transcript rendering, console/page errors, and fidelity
after a full reload.

## Run the checks

From `fleet-hub/`:

```bash
npx playwright install chromium
npm run test:ux
```

CI installs Chromium and runs the same command in the existing `Hub` job after
build and lint. A failed check retains a Playwright trace; `test-results/` and
`playwright-report/` are local artifacts and are ignored by Git.

## Add a fixture or journey

- Put reusable protocol state in `tests/ux/replay-server.mjs` and browser setup
  in `tests/ux/replayHost.ts`. Route every REST response and WebSocket frame
  explicitly so a missing contract fails visibly.
- Put user journeys in `tests/ux/*.spec.ts`. Assert the visible structured DOM,
  relevant keyboard/focus behavior, and state after reload or reconciliation.
- Capture `console.error` and uncaught page errors. Expected offline/error
  journeys must route their failure deliberately and assert the visible state;
  do not broadly suppress browser errors.
- Prefer semantic roles and exact visible copy. Add targeted screenshots only
  for a stable stateful surface, disable animation, and review the focused diff.
  Do not introduce full-page or blanket snapshots.

Fixtures must be authored from synthetic values. Never copy a real JWT,
hostname, project path, transcript, prompt, username, email address, or other
personal data into the replay, trace, screenshot, log, issue, or PR. The
checked-in token string is an inert fixture marker and cannot authenticate
anywhere.

## Regression intake and repair

Every confirmed UX defect needs the smallest deterministic replay and a failing
journey before its fix. A low-risk repair may use the existing backlog loop and
an isolated worktree; it does not create another scheduler. Any PR generated
automatically from this regression workflow stays a draft for human review,
even when its checks pass. Ambiguous behavior becomes a backlog issue with
evidence and a decision request. The workflow never auto-merges, releases,
deploys, changes secrets, migrates hosts, or operates on real user data.
