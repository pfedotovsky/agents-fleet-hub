# Codex app-server desktop-visibility spike — 2026-08-02

Backlog: private issue #36, “Codex app-server integration spike: desktop
visibility and protocol fit”.

## Question

Can fleet-server drive Codex through the official app-server protocol so that
Agents Hub sessions appear as ordinary tasks in the native Codex desktop app,
while also replacing the hub's reconstructed model/context metadata with
runtime contracts?

## Environment and method

- Codex CLI / app-server: `0.146.0` on macOS.
- Generated the installed protocol bindings with
  `codex app-server generate-ts --experimental`.
- Spawned `codex app-server` over its default JSONL-over-stdio transport.
- Initialized it with the custom client name `agents_hub_spike`; no first-party
  client identity was imitated.
- Started one non-ephemeral thread with the repository root as `cwd`, requested
  read-only sandboxing, sent a unique no-tools prompt, waited for
  `turn/completed`, and named the thread
  `Agents Hub app-server visibility spike 2026-08-02`.
- Queried `thread/read` and `thread/list` with the default source filter and
  explicit `cli`, `vscode`, `appServer`, `exec`, and `unknown` filters.
- Queried the Codex desktop app's cross-source recent-task list separately.

Test thread id: `019fc3ef-7bb2-7a42-852b-309df761f342`. It is intentionally
left available temporarily for visual inspection and can be archived or
deleted after the pilot.

## Results

### Native desktop visibility works on the current local stack

The custom client created a thread whose persisted source is `vscode`, with
`threadSource: null`. It appears in:

- default `thread/list` (interactive sources);
- explicit `thread/list {sourceKinds:["vscode"]}`;
- the Codex desktop app's own recent-task list, with the same thread id, name,
  `cwd`, preview, and timestamps.

It does **not** appear under explicit `appServer`, `cli`, `exec`, or `unknown`
source filters. This source classification is surprising but favorable for
desktop compatibility. Treat it as verified behavior for 0.146.0, not yet as a
documented stability guarantee across future CLI versions.

This confirms the important product hypothesis: threads driven through
app-server from their creation can be native Codex desktop tasks. It does not
provide a supported import path for existing SDK-created rollouts.

### App-server is a better source of UI truth

`model/list` returned the active picker catalog directly, including the default
model, display names, descriptions, supported reasoning efforts, default
effort, input modalities, service tiers, and hidden state. On this installation
the visible catalog reported `gpt-5.6-sol` as the default, followed by Terra,
Luna, 5.5, 5.4, and 5.4 Mini. This is materially richer and safer than reading
`~/.codex/models_cache.json` directly.

The live turn stream included `thread/tokenUsage/updated`. The generated
`ThreadTokenUsage` contract contains exact total/last token breakdowns plus
`modelContextWindow`, so app-server can replace the hub's inferred Codex
context-window display.

Other observed lifecycle notifications included thread/turn start and status,
item start/completion, agent-message deltas, rate-limit updates, turn
completion, and thread-name updates. `thread/start` also returned the exact
instruction files loaded for the chosen `cwd`.

### Managed requirements remain authoritative

The spike requested `approvalPolicy: "never"`, but the local managed
requirements allow only `unless-trusted` or `on-request`. App-server emitted a
warning and applied the required fallback. A fleet-server adapter must expose
the effective returned policy and warnings rather than assuming that the
requested policy won.

## Recommendation

Proceed with an app-server adapter behind a fleet-server feature flag. Keep the
current SDK path as a rollback until the following vertical slices are live
verified:

1. Supervised local stdio client lifecycle, initialization, restart, bounded
   request queue, and generated stable schema subset.
2. `model/list` and `thread/tokenUsage/updated` as the Codex model/context
   sources of truth.
3. Thread start/resume plus turn/item event normalization into the hub's
   existing WebSocket contract.
4. Approval, request-user-input, abort/steer, archive/delete, compaction, and
   shell-command mappings.
5. Native desktop visibility on a real Agents Hub session and then on one SSH
   remote host before making app-server the default.

Do not expose app-server directly to the browser or a public network. The
fleet-server REST/WebSocket gateway remains the authenticated remote boundary.

## Implementation status — 2026-08-03

Vertical slice 1 is implemented on private backlog #37. The fleet-server
foundation now includes:

- a supervised local stdio child lifecycle with initialize/initialized,
  correlated requests, bounded pending work, request timeouts, and restart;
- an honest `agents_hub` / `Agents Hub` identity with no experimental protocol
  opt-in;
- a minimal checked-in protocol subset generated from Codex CLI 0.146.0 and an
  exact 0.146.x compatibility gate;
- notification and server-request dispatch points, with unsupported server
  requests answered explicitly;
- a disabled-by-default construction boundary. It is not connected to the
  existing provider send path yet, so the SDK remains the production default.

Vertical slice 2a now routes feature-flagged Codex model discovery through
paginated `model/list`. The mapper preserves provider order, explicit default,
display metadata, reasoning efforts, personality support, and input modalities;
hidden rows remain excluded and missing modality metadata uses the documented
text+image compatibility default. A failed app-server lookup returns to the
existing Codex cache, and the flag-off path is unchanged. This does not route
conversations through app-server yet.

The focused lifecycle and model suites pass 11 tests, the full fleet-server
suite passes 135 tests, and typechecking passes. A sanitized live probe against
the installed Codex CLI 0.146.0 returned seven picker-visible models,
`gpt-5.6-sol` as the explicit default, the current effort catalogs, and model
modalities without creating a thread. Token-usage notifications and effective
settings/warnings are the remaining vertical-slice-2 work.

## Remaining uncertainty

- The desktop-visible `vscode` source produced for a custom client is verified
  but not clearly promised by the public source-kind documentation.
- This spike verified same-machine desktop visibility. SSH-host visibility is
  still required before rollout to remote fleet hosts.
- Compatibility currently fails closed before spawn when the host CLI's
  major/minor differs from the generated 0.146 baseline. A future CLI upgrade
  therefore requires regenerating the consumed subset and running compatibility
  verification; automatic fallback selection belongs to the later provider
  wiring slice.
