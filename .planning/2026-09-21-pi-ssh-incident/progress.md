# Progress Log

## 2026-09-21
- 创建本次事故调研的独立规划目录。
- 已开始复核工具挂载与远端 cwd 两条证据链。
- GitHub MCP 已核对 Pi v0.86.1 的 `getAllTools`/`getActiveTools`、transcript tool restore、bash `ctx.cwd` 行为。
- 对比了官方 `tools.ts`/`ssh.ts`、`pi-loaded-tools`、`pi-cwd`、`pi-ssh-remote`：成熟模式分别是 branch-aware active-tool restore、registry/active provenance diagnostics、stable tool interception、stable native tools with internal remote routing。
- advisor 建议已纳入：先区分 registry/active/harness 三层，修复 cwd 单一来源，并补三类回归测试；当前尚未修改代码。

## 2026-09-21（实施与验证）
- 修复 `ssh_bash` 的 cwd 单一来源：POSIX 和 Windows PowerShell 脚本均固定使用 `activeTarget.remoteCwd`，并不再转发 Pi context，避免 Windows 控制端路径泄漏到远端。
- 增加 `ssh-tool-state.js` 及测试，区分已注册工具、active 工具、缺失注册和 inactive 工具；在 `session_start`、`session_tree`、`before_agent_start` 和激活流程中恢复已注册 SSH 工具并输出诊断。
- `npm test`：19/19 通过；Pi 0.86.1 loader smoke、`npm pack --dry-run`、Node syntax check 和 `git diff --check` 均通过。
- 本次范围保持为 P1 最小修复；稳定原生工具路由 P2 未实施，真实 SSH 目标端到端验证仍待后续环境测试。
