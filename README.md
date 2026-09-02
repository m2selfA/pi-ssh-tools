# pi-ssh-tools

HackXIt standalone derivative of `@ogulcancelik/pi-ssh-tools` for [pi](https://github.com/earendil-works/pi).

Turn SSH mode on only when you need it, keep local tools untouched, and give the agent a separate remote toolset:

- `ssh_activate`
- `ssh_status`
- `ssh_deactivate`
- `ssh_read`
- `ssh_write`
- `ssh_edit`
- `ssh_bash`

## Attribution

This repository is a standalone derivative/extraction of `packages/pi-ssh-tools` from Can Celik / `ogulcancelik`'s monorepo:

- Source monorepo: <https://github.com/ogulcancelik/pi-extensions>
- Source package path: `packages/pi-ssh-tools`
- Baseline commit: `a9cafebd46f049a67bc45208b76015c464dbb912`
- Baseline npm package: `@ogulcancelik/pi-ssh-tools@0.1.5`

The original MIT license is preserved in `LICENSE`. See `FORK.md` for derivative details.

## Install

```bash
pi install git:github.com/HackXIt/pi-ssh-tools
```

## What it does

This package adds `/ssh` for manual use and agent-callable tools for API/non-interactive activation.

- Default is off
- No persistence across sessions
- Local `read`, `write`, `edit`, and `bash` stay local
- When SSH mode is active, the agent also gets `ssh_read`, `ssh_write`, `ssh_edit`, and `ssh_bash`
- The active remote host and cwd are injected into the system prompt while SSH mode is on

That makes remote work explicit instead of silently swapping out local tools.

## Role with runwatch / pi-runs

For the current Pi-first durable-compute stack, responsibilities are intentionally split:

```text
pi-ssh-tools  -> Pi-online remote workspace read/write/edit/shell
pi-runs       -> Pi tools, session/branch binding and continuation UX
runwatch      -> durable Run/Attempt/Observation/Delivery lifecycle
```

`pi-ssh-tools` does **not** become a long-lived scheduler watcher, durable Run ledger, or offline continuation service. After a runwatch completion resumes Pi, the model explicitly calls `ssh_activate` for the recorded `host:/cwd` before inspecting scientific outputs. The three projects share only the `RemoteWorkspaceRef { host_alias, cwd }` semantic boundary; they do not share SSH connection objects.

The current release program finishes `runwatch` + `pi-runs` first. Codex/other-agent support is post-v1 design work and must not expand this Pi-specific workspace plugin. See [docs/INTEGRATION_BOUNDARY.md](docs/INTEGRATION_BOUNDARY.md).

## Agent-callable activation

Use `ssh_activate` before remote work:

```json
{ "target": "mac:/Users/me/project" }
```

The `target` syntax matches `/ssh <host>[:path]`:

```text
host
user@host
host:/remote/path
user@host:/remote/path
```

Then call:

- `ssh_status` to inspect active state, including the detected remote platform
- `ssh_deactivate` to turn SSH mode off
- `ssh_read`, `ssh_write`, `ssh_edit`, and `ssh_bash` for remote work

If `ssh_activate` is called without a target in an interactive UI, it may show the existing SSH host picker. In non-interactive contexts it fails clearly and requires an explicit target.

## Manual usage

```text
/ssh
/ssh mac
/ssh clawd
/ssh mac:/Users/can/project
/ssh status
/ssh off
```

When `/ssh` is called with no arguments, the extension offers hosts from `~/.ssh/config`.

You can always bypass the picker and type a host manually:

```text
/ssh user@host
/ssh user@host:/remote/path
```

That means the package still works even if you do not use `~/.ssh/config`.

## How host selection works

The picker reads `Host ...` aliases from your local `~/.ssh/config`.

- wildcard entries like `Host *` are ignored
- aliases are used as the SSH target directly
- if no remote path is provided, the extension resolves it with a platform-specific SSH probe (`pwd` on POSIX or PowerShell `Get-Location` on Windows)

This is mainly a convenience layer. SSH config is not required for the actual remote tools.

## Requirements

- [pi](https://github.com/earendil-works/pi)
- local `ssh` client available in `$PATH`
- key-based auth or another non-interactive SSH setup
- POSIX targets: `bash` available on the remote host
- Windows targets: `powershell.exe` is available on the remote host; the OpenSSH default shell may be `cmd.exe` or PowerShell

## Notes

- `ssh_activate` probes the remote command shell and records `platform: posix` or `platform: windows-powershell`; Windows detection uses `cmd.exe`/explicit PowerShell probes instead of running POSIX utilities first
- Programmatic SSH calls disable X11 forwarding, so a local `ForwardX11 yes` setting does not break non-GUI remote commands
- POSIX targets keep the historical `bash`/`cat`/`test`/`mkdir` backend
- Windows PowerShell targets run through an explicit noninteractive `powershell.exe` stdin script and use `(Get-Location).Path`, `Test-Path`, .NET file APIs, and PowerShell `Set-Location -LiteralPath`; this works even when the OpenSSH default shell is `cmd.exe`
- `ssh_write` writes file content over stdin, which behaves better than GNU-specific `base64 -d` shell snippets and also avoids command-line length limits on Windows
- relative remote paths resolve against the active remote cwd
- remote POSIX and Windows paths are normalized before Pi's local path resolver runs, so Windows control clients can safely address macOS/Linux paths such as `/Users/me/project/file.txt`
- absolute paths outside the active remote cwd are carried through an internal virtual path and still execute on the remote host
- remote `~` paths resolve against the detected remote home directory
- image reads are supported for common extensions: jpg, jpeg, png, gif, webp
- `ssh_bash` renders the target and the exact command in the TUI; on POSIX targets command text is bash-highlighted, and on Windows targets the command still renders in the same compact shell block while the prompt/system guidance tells agents to use PowerShell syntax

## Development

Run the path-mapping regression tests with:

```bash
npm test
```

The tests cover Windows-to-POSIX absolute paths, relative paths, traversal, remote home expansion, virtual-path collisions, and Windows PowerShell targets.


