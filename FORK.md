# Fork / derivative notice

This repository is a standalone derivative/extraction of `pi-ssh-tools`, not a direct GitHub fork object.

## Original source

- Original author: Can Celik / `ogulcancelik`
- Source monorepo: <https://github.com/ogulcancelik/pi-extensions>
- Source package path: `packages/pi-ssh-tools`
- Baseline commit: `a9cafebd46f049a67bc45208b76015c464dbb912`
- Baseline npm package: `@ogulcancelik/pi-ssh-tools@0.1.5`
- License: MIT, preserved in `LICENSE`

## Import method

The package history was extracted from the upstream monorepo path `packages/pi-ssh-tools` using `git subtree split` where practical, then used as the initial history for this standalone repository.

## HackXIt changes

- Changed package metadata to point at `HackXIt/pi-ssh-tools`.
- Added explicit attribution and this derivative notice.
- Added agent-callable activation/status/deactivation tools:
  - `ssh_activate({ target?: string })`
  - `ssh_status({})`
  - `ssh_deactivate({})`
- Updated `ssh_bash.renderCall` to render the active target and bash-highlight the exact command while keeping built-in bash output rendering.
- Added cross-platform remote path mapping for `ssh_read`, `ssh_write`, and `ssh_edit`, plus consistent remote cwd handling for `ssh_bash`; this covers Windows controller to POSIX remote paths and remote home expansion.
- Added path-mapping regression tests and bumped the package to `0.1.5-hackxit.2`.
