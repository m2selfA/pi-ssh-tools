# Integration Boundary

Last updated: 2026-09-02

`pi-ssh-tools` is the **Pi-online Remote Workspace Plane** in the current durable scientific-compute stack.

## Frozen responsibilities

| Project | Owns | Does not own |
|---|---|---|
| `pi-ssh-tools` | explicit Pi-online SSH activation, remote read/write/edit/shell, remote cwd/platform UX | durable Run state, scheduler watching, offline continuation |
| `pi-runs` | Pi-native Run tools, Pi session/branch binding, continuation messages/status | scheduler authority, generic SSH workspace implementation |
| `runwatch` | durable Run/Attempt/Observation/Delivery state, scheduler lifecycle, narrow lifecycle SSH, retry | Pi workspace editor, scientific reasoning |

Shared semantic only:

```text
RemoteWorkspaceRef { host_alias, cwd }
```

A completion does not silently persist SSH activation. After Pi is resumed, `pi-runs` may guide the model back to the recorded workspace, but the model must explicitly call `ssh_activate` before `ssh_read` / `ssh_edit` / `ssh_bash`.

## Current development priority

The first production release is Pi-first. Development priority is:

1. finish `runwatch` distribution/install/readiness and durable endurance gates;
2. finish `pi-runs` repeatable real-Pi acceptance, soak and legacy retirement;
3. keep `pi-ssh-tools` stable unless the Pi product loop exposes a concrete workspace-plane defect;
4. only after `runwatch` + `pi-runs` v1 is complete, reconsider other coding-agent integrations.

Future Codex/other-agent support should use independent Agent Integration projects rather than extending `pi-ssh-tools` or embedding additional agent-specific behavior into runwatch. A possible future `codex-runs` exists only as a design concept today; no repository or implementation is part of the current phase.

## Invariants

- Never add scheduler polling or a durable Run ledger here.
- Never auto-activate a remote workspace merely because a Run completed.
- Keep local Pi tools local; remote behavior remains explicit through `ssh_*` tools.
- Do not import runwatch or pi-runs as an in-process dependency just to share SSH state.
- Treat `~/.ssh/config` aliases as a convenience/interop identity, not a second application-owned host database.
