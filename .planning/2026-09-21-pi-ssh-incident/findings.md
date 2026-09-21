# Findings

## 1. 用户证据的边界

用户提供的证据证明了两个现象，但不能直接把两者都归因于 harness：

| 现象 | 已能证明的事实 | 尚需区分 |
|---|---|---|
| system prompt 写 SSH active，但可见工具只有本机工具 | 当前 agent request 的 active tool loadout 没有 `ssh_*` | 扩展未加载，还是扩展已加载但工具被 `setActiveTools`/session restore 移除 |
| `ssh_bash` 曾执行 `cd C:\\Users\\inter\\Desktop\\CD` | Windows controller cwd 泄漏进远端 bash | SSH 连接/认证本身不是根因 |
| 普通 `ssh gyz` 能读远端文件 | gyz、认证、远端仓库均可用 | 不证明 Pi extension 生命周期正确 |

Pi 0.86.1 明确区分：
- `pi.getAllTools()`：已注册工具（registry）。
- `pi.getActiveTools()`：当前 provider/LLM 可调用工具（active loadout）。

因此，必须分别检查 registry 和 active loadout；“工具注册表没有”只有在 `getAllTools()` 也没有 `ssh_*` 时才成立。

## 2. GitHub MCP / Pi 官方源码证据

来源均为 `earendil-works/pi` v0.86.1：

- `packages/coding-agent/src/core/agent-session.ts`
  - `getActiveToolNames()` 读取 `agent.state.tools`。
  - `getAllTools()` 读取 `_toolDefinitions`。
  - `setActiveToolsByName()` 只启用 registry 中存在的名字，未知名字静默忽略。
  - `_restoreToolsFromTranscript()` 从当前 session system message 的 `toolsAdded` 恢复 active tools。
  - `_handleSessionTree()` 在树导航后调用 `_restoreToolsFromTranscript()`。
  - `_refreshToolRegistry()` 重新生成 registry，并根据 active names/extension tools 重建 active loadout。
- `packages/coding-agent/docs/extensions.md`
  - `before_agent_start` 可修改结构化 `systemPromptOptions`。
  - `pi.setActiveTools()` 会同时影响 prompt 和 provider executable tools。
  - `/tree` 只有 `session_tree`，不是 `session_start`；扩展若持有 session 状态，应在相关生命周期自行恢复。
  - 动态工具推荐“注册全部工具，保留 loader/control tool active，执行时再 setActiveTools”。
- `packages/coding-agent/src/core/tools/bash.ts`
  - `createBashToolDefinition(cwd)` 的 execute 使用 `ctx?.cwd || cwd`。
  - 随后把这个 cwd 传给 `operations.exec(command, spawnContext.cwd, ...)`。
- `packages/coding-agent/examples/extensions/ssh.ts`
  - 官方示例在 wrapper execute 中忽略 `_ctx`，避免把 Pi 的本地 `ctx.cwd` 传入远端操作。
  - `createRemoteBashOps` 自己把收到的 local cwd 映射到 remote cwd。
- `packages/coding-agent/docs/packages.md`
  - `pi install ...` 写入 settings；默认用户作用域为 `~/.pi/agent/settings.json`，项目作用域用 `-l` 写入 `.pi/settings.json`。
  - `pi -e ...` 仅当前运行临时加载。
  - 项目包需在 project trusted 后才能自动安装/加载。

## 3. ContextX 结果

ContextX 检索到的相关结果与官方源码一致：

- `ssh_bash` 的核心风险是 `createBashTool` 在 Pi 0.86.x 中优先使用 `ctx.cwd`。
- Windows controller + Linux remote 会把 `C:\\...` 当作远端 cwd，导致远端 `cd` 失败。
- 相关 GitHub 线索包括 Pi 的 cwd 行为修复 PR #8627 与 Windows/remote path issue #5350；Issue/PR 页面本身未能通过当前 GitHub MCP 权限直接读取，因此不把其评论内容当作已验证结论。

## 4. 当前仓库代码中的确定性 bug

当前 `index.ts`：

```ts
const tool = createBashToolDefinition(target.remoteCwd, {
  operations: createRemoteBashOps(target),
});
return tool.execute(toolCallId, params, signal, onUpdate, ctx);
```

而 `createRemoteBashOps(target)` 使用 operations 收到的 `cwd`：

```ts
exec: async (command, cwd, ...) => {
  const script = `cd ${shellQuote(cwd)}\\n${command}\\n`;
}
```

由于 Pi v0.86.1 的 `bash.ts` 优先使用 `ctx.cwd`，这里的 `cwd` 在 Windows controller 上就是本地 Windows cwd。用户报告的命令与该调用链逐字吻合。

## 5. 工具缺失的最可能分支

### 分支 A：真正未加载（registry 缺失）
判据：
- `/ssh` 不在 commands；
- `pi.getAllTools()` 不含 `ssh_*`；
- `pi -e <package-or-path> --mode rpc` 的 `get_commands` 也不含 `ssh`。

常见原因：当前项目不 trusted、package 未出现在 user/project settings、只在另一 Pi 进程里用了 `-e`、或新 session 使用了不同安装 scope/版本。

### 分支 B：扩展已加载，但 active loadout 被覆盖（更符合“短暂可用后消失”）
判据：
- `pi.getAllTools()` 含 `ssh_*`；
- 但 `pi.getActiveTools()`/provider tool list 不含它们；
- `/ssh` command 仍存在，或 before_agent_start 仍能看到 SSH 状态。

Pi 0.86.1 在 tree navigation 后从 transcript 恢复 tool loadout；其他 preset/tools 扩展也可能调用 `pi.setActiveTools([...])` 覆盖 SSH 工具。现有插件只在 `session_start` 和 `activate()` 时调用 `enableSshTools()`，没有在 `session_tree` 或 `before_agent_start` 做一致性修复。因此“SSH prompt 仍在，但 ssh_* 已不在 active tools”是可行的。

### 分支 C：harness/上层工具白名单过滤
判据：
- Pi 进程内部 `getAllTools()` 与 `getActiveTools()` 均含 `ssh_*`；
- 但外层 agent request/工具注入层只暴露本机 `functions.*`。

这时插件不能靠自身修复；必须修 harness 的 extension tool forwarding/allowlist，或让该会话以原生 Pi tool registry 运行。

## 6. 推荐解决方案

### P0：先恢复当前会话
1. 不要等待 `ask_user_question`；它不会重建 tool registry。
2. 执行 `/reload`（仅适用于已自动发现的扩展）；若 package scope/安装不确定，直接重启 Pi。
3. 用 `pi list` 确认包存在；用 `pi -e <package-or-path>` 做一次隔离启动验证。
4. 若当前会话仍只暴露 functions 工具，记录 Pi 内部 registry/active 结果后交给 harness 处理。

### P1：修插件的 active-tool 自愈
新增 `ensureSshTools()`：
- 先用 `pi.getAllTools()` 检查 `ssh_*` 是否注册；缺失时报告“extension not loaded”，不要静默声称 SSH active。
- 对 active tools 使用集合并集，不覆盖其他扩展工具。
- 在以下时机调用：
  - `session_start`：保留 control tools；
  - `session_tree`：恢复当前 active target 的 remote tools；
  - `before_agent_start`：在写入 SSH prompt 前最后一次校验 active loadout。
- 可将 `ssh_activate`/`ssh_status` 作为常驻 control tools，`ssh_read/write/edit/bash` 只在 active target 时启用；这样即使 remote tools 被 session restore 清掉，模型仍有恢复入口。

### P1：修 `ssh_bash` cwd 泄漏
两层防护：
1. `createRemoteBashOps` 忽略 Pi 传入的 controller cwd，始终使用 `target.remoteCwd`（远端 bash 工具没有独立 cwd 参数，当前设计下这是正确语义）。
2. 调用内建 bash definition 时不要把原始 `ctx` 直接传入；或者传入 `{ ...ctx, cwd: target.remoteCwd }` 的 remote context，避免 Pi core 在未来扩展时再次取到本地 cwd。

POSIX 远端最终必须执行：

```bash
cd '/home/shark/...'
<command>
```

而不是任何 `C:\\...` 路径。

### P2：采用稳定工具路由（推荐的长期方案）
借鉴 `pi-ssh-remote`，可以把 `ssh_read/write/edit/bash` 重构为对 Pi 原生 `read/write/edit/bash` 的稳定包装：

- 工具始终注册、始终可诊断；远端模式只改变 operations/路由，不改变 active tool 名称。
- `/ssh` 或 `ssh_activate` 只负责连接、切换状态和更新 footer/prompt。
- 远端未激活时包装器直接调用本地工具；远端激活后调用远端 operations。
- 通过 session custom entry 保存 endpoint、remote cwd、platform 和 routing 状态，在 `session_start`/`session_tree` 恢复。

这能从根上消除“prompt 说 active，但 ssh_* 工具被 active loadout 清掉”的一类故障；代价是模型-facing API 从 `ssh_*` 改为原生工具，需要兼容迁移期（保留旧工具名或提供别名）。

### P3：回归测试与可观测性
- 增加 mock `ssh` 可执行文件测试：Windows controller cwd + Linux target 必须断言生成的第一条命令使用 `target.remoteCwd`。
- 增加 lifecycle 测试：模拟 `session_tree`/外部 `setActiveTools(["read","edit"])` 后，`before_agent_start` 必须恢复 SSH tools。
- 增加 registry/active diagnostics：`ssh_status` 返回 `registered`、`active` 和缺失工具列表；若 registry 缺失，明确提示重新加载 extension/harness，而不是提示 SSH 网络失败。
- package contract 继续验证 `pi.extensions`、实际 loader、tool schema 和 package-root RPC loading。

## 7. 其他 Pi 插件的可复用模式

通过 GitHub MCP 对比了三个实现：

### 官方 `tools.ts`：显式持久化 active loadout

`earendil-works/pi/packages/coding-agent/examples/extensions/tools.ts`：

- 使用 `pi.getAllTools()` 取得 registry，使用 `pi.getActiveTools()` 取得 active set。
- 用 `pi.appendEntry("tools-config", { enabledTools })` 持久化，而不是依赖 prompt 文本。
- 在 `session_start` 和 `session_tree` 都按当前 branch 恢复工具选择。
- 恢复前过滤掉已经不存在的工具。

这直接说明只在 `session_start` 调用一次 `setActiveTools()` 不足以覆盖 `/tree`/branch 场景。

### `pi-loaded-tools`：显示 registry/active/source 三元组

`shaftoe/pi-loaded-tools`：

- 用 `pi.getAllTools()` + `new Set(pi.getActiveTools())` 生成诊断视图。
- 展示每个工具的 `active` 状态、`sourceInfo.source`、scope、package/path provenance。
- 明确区分“工具已加载但 inactive”和“工具根本不在 registry”。

这正是本仓库目前缺少的诊断能力，建议把同样的三元组放入 `ssh_status` 或 `/ssh status`。

### `pi-cwd`：不改变 tool registry，拦截工具调用

`harms-haus/pi-cwd`：

- 保持 Pi 原生 `bash/read/write/edit/grep/find/ls` 工具稳定存在。
- 用 `tool_call` 修改参数；用 `user_bash` 替换用户 shell 的 operations；用 `before_agent_start` 更新提示。
- 用 `appendEntry("cwd-change", ...)` 并在 `session_start`、`session_tree` 恢复状态。

可借鉴其“稳定工具 + 路由状态”的思路，避免 SSH 工具因 active set 被覆盖而消失。

### `petrichor20211/pi-ssh-remote`：稳定注册原生工具，内部路由

该插件是最接近本问题的成熟实现：

- 始终注册并暴露标准 `read/write/edit/bash`，不依赖动态添加 `ssh_*` 工具。
- execute 内部按 `remote && routeRemoteTools` 选择本地或远端 operations。
- `remoteBashOps` 对传入 cwd 做 `mapPath(cwd)`，将本地 cwd 映射到远端 cwd；远端路径在连接时验证并持久化。
- 连接状态、远端 cwd、路由开关通过自定义 session entry 持久化，在 `session_start` 恢复。
- `before_agent_start` 只负责提示词；工具路由不依赖 prompt 注入。

这证明更稳健的长期架构是：**工具名称稳定，执行路由状态可变；状态持久化独立于工具 active loadout**。

## 8. 结论

用户的两个判断方向基本正确，但“主要问题一定是未注入”尚未被证据完全证明。最稳妥的结论是：

1. `ssh_bash` 的 Windows cwd 泄漏是仓库代码的确定性 bug，应直接修复。
2. 工具缺失必须先区分 registry 缺失、active loadout 被覆盖和 harness 白名单过滤；Pi 0.86.1 的 `getAllTools()`/`getActiveTools()` 分离以及 transcript restore 机制使第二种情况完全可能。
3. 插件应加入 active-tool 自愈和显式诊断，但若 `getAllTools()` 本身为空，最终仍需要重启/重新加载或修复 harness 的扩展注入层。
