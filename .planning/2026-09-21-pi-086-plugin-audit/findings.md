# Findings

## Scope
本文件记录通过 GitHub MCP 阅读 `earendil-works/pi` 的 `v0.86.0`、`v0.86.1` 和本仓库审查所得的可验证证据。

## pi 版本与上游证据

- `v0.86.0` tag 指向 commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。
- `v0.86.1` tag 指向 commit `13cbf77df2396303013a41646bcfa77b4271ae56`。
- `packages/coding-agent/docs/extensions.md` 在两个 tag 的 GitHub blob SHA 都是 `b45163108c7a422a9269f0f0235af2af70331057`，说明扩展编写/加载文档在 0.86.0 到 0.86.1 之间没有变化。
- `packages/coding-agent/src/core/extensions/loader.ts` 在两个 tag 的 blob SHA 都是 `ab7ec239ab8574ad4986182e895913d36ac6f680`；`src/core/pi-manifest.ts` 都是 `fd7dd5edb6e46571a56dd379b210e47175114a51`；`docs/packages.md` 都是 `cadeb18673a08b8f2812510abac3a5a33804b4a9`。因此 0.86.1 没有暗中改变入口发现、manifest 或核心依赖规则。
- 0.86.0 的 `packages/coding-agent/CHANGELOG.md` 明确记录：
  - `user_bash` 改为 fail-closed；处理器必须返回 `undefined` 继续传播，或返回 `{ operations }` / `{ result }`。
  - `ToolCall.arguments`、`ToolResultMessage.details` 限制为 JSON-compatible 值。
  - 新增 `before_agent_start` 的 transcript-backed system prompt/tool 更新。
  - 新增 `ctx.modelRegistry.stream()` / `streamSimple()`。
  - `pi.on()` 返回 unsubscribe 函数。
  - 导出此前遗漏的 extension hook event/result 类型。
  - 默认内置工具启用 strict-prefer JSON-schema sampling；扩展可通过 `constrainedSampling: false` 明确关闭。
  - 没有参数 schema 的扩展工具会在注册期间被拒绝。
- 0.86.1 的 release body 与 coding-agent changelog 仅记录 Meta Muse provider、Node persistent compile cache、bug/clipboard/provider 等修复，没有新增或改变扩展注册契约；它把包版本从 0.86.0 升到 0.86.1。

## pi 0.86.x 插件/扩展硬性契约

依据两个 tag 的 `docs/extensions.md`、`docs/packages.md`、`src/core/extensions/loader.ts`、`src/core/pi-manifest.ts`、`src/core/extensions/types.ts`：

1. 扩展模块必须导出 default factory，factory 接收 `ExtensionAPI`，可同步或异步。
2. 分发包可在 `package.json` 的 `pi.extensions` 中声明相对包根的 `.ts`/`.js` 入口；`pi` manifest 的资源字段是字符串数组。
3. npm/git 安装包的运行时依赖必须放在 `dependencies`；`devDependencies` 不会在默认生产安装中提供。
4. Pi 已内置的核心模块（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox` 等）应放在 `peerDependencies`，不要打包/重复安装。
5. 每个 `pi.registerTool()` 定义必须有对象参数 schema；官方实现会在 loader 中直接拒绝缺失或非对象 schema。
6. 工具执行错误必须 `throw` 才会产生 `isError: true`；返回值中的自定义 `details` 等状态必须是 JSON-compatible。
7. 工具输出应使用 Pi 导出的截断/内置工具实现，默认上限是 50KB 或 2000 行，以免污染模型上下文。
8. 0.86.0 引入结构化 `before_agent_start` prompt sections；优先修改 `event.systemPromptOptions.sections`、`selectedTools` 或 `promptGuidelines`，避免每轮返回完整 `systemPrompt` 导致整段 prompt 替换和缓存失效。
9. 扩展工厂不应在加载阶段启动长生命周期进程、socket、watcher、timer；应延迟到 session/tool/event，并在 `session_shutdown` 清理。

## 本仓库初审

- `package.json` 已声明 `"type": "module"`、`"pi": { "extensions": ["./index.ts"] }`、`pi-package`/`pi-extension` keywords；入口存在于 npm 包文件列表中。
- `index.ts` 导出 default `sshToolsExtension(pi: ExtensionAPI)`，符合 factory 契约。
- 依赖的 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox` 都在 `peerDependencies` 且未进入 `dependencies`/`bundledDependencies`，符合 Pi package 文档。
- `ssh_activate`、`ssh_status`、`ssh_deactivate`、`ssh_read`、`ssh_write`、`ssh_edit`、`ssh_bash` 均提供 `Type.Object(...)` 参数 schema；其中 read/write/edit/bash 复用 Pi 内置 tool definitions，满足 0.86.0 的 schema 要求。
- 自定义工具返回的 `details` 是状态对象或委托给 Pi 内置工具；本仓库没有注册 `user_bash` handler，因此不触发 0.86.0 的 fail-closed user_bash 契约。
- 当前 `before_agent_start` 返回 `event.systemPrompt + ...` 的完整替换。该写法仍被 0.86.x 接受，但与 0.86.0 文档推荐的结构化 sections 不一致，会在每次 active SSH turn 触发整段 system prompt 替换；应改为维护一个 `ssh_mode` section，并在 inactive 时删除。
- 当前 `npm pack --dry-run` 的文件清单不包含 README 引用的 `docs/INTEGRATION_BOUNDARY.md`，这是 npm 分发完整性问题；应把 `docs` 纳入 `files`，不影响运行时资源发现。
- README/工具说明把 Windows 执行描述为 “PowerShell Core”，实现实际调用的是 `powershell.exe`（Windows PowerShell）；应改为不误导的 “PowerShell syntax”。
- 当前没有针对 package manifest、结构化 prompt section 或 Pi 0.86.x 加载契约的自动回归测试；验证阶段需要补充可执行的静态/package smoke check，并运行现有测试。

## Decisions

- 采用最小兼容性修改：不新增服务、不引入 runtime 依赖，不把 Pi 核心包从 peerDependencies 改成 dependencies。
- 先保留 Node engine 现有范围，除非执行验证或上游文档给出必须升级的直接证据；Pi host 自身的 Node 版本不等于插件 package 的独立最低版本。
