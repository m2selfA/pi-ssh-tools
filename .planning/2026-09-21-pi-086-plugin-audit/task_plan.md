# pi 0.86.x 插件兼容性审查与改进

## Goal
使用 GitHub MCP 以 `earendil-works/pi` 的 `0.86.0` 与 `0.86.1` 版本为权威依据，审查本仓库插件实现是否符合最新版插件契约，实施必要改进，并用测试/静态证据验证。

## Phases

### Phase 1: 研究 pi 0.86.0/0.86.1 插件契约
**Status:** complete
- [x] 获取两个版本的 tag、目录树、发布/变更信息。
- [x] 阅读插件文档、类型定义、运行时加载代码与代表性插件示例。
- [x] 将要求和证据记录到 `findings.md`。

### Phase 2: 审查本仓库
**Status:** complete
- [x] 检查 package.json、入口、导出、依赖、README、测试与构建/发布配置。
- [x] 按要求逐项判定符合、缺失或不适用，并记录证据。

### Phase 3: 实施最小兼容性改进
**Status:** complete
- [x] 修改代码/元数据/文档/测试以满足已确认要求。
- [x] 避免新增可由现有基础设施承担的服务或运行时依赖。

### Phase 4: 验证与总结
**Status:** complete
- [x] 运行测试、类型/语法检查及插件加载相关验证。
- [x] 复核差异、更新进度和结论，列出残余风险。

## Next Step
全部完成；剩余风险是未连接真实 SSH 目标做端到端远程操作验证，本次只验证 Pi loader/package contract 和本地回归。

## Requirement Matrix

| 上游要求/证据 | 原仓库状态 | 改进/结论 | 验证 |
|---|---|---|---|
| `v0.86.0`/`v0.86.1` `packages/coding-agent/docs/packages.md`：`pi.extensions` manifest、核心包使用 `peerDependencies`、运行时依赖放 `dependencies` | 已有 `pi.extensions` 和三项 Pi peer，未打包核心包 | 保留并加入 package contract test；补齐 npm `files` 中 README 引用的 `docs/` | `plugin-contract.test.mjs`、`npm pack --dry-run` |
| `packages/coding-agent/src/core/extensions/loader.ts`：每个工具必须有对象参数 schema；0.86.0 changelog `ToolResultMessage.details` 需 JSON-compatible | 7 个工具均有 `Type.Object` 或 Pi 内置 definition schema；details 为 JSON 状态/内置结果 | 无需改注册契约 | Pi 0.86.1 package-root RPC smoke 无 schema/extension error |
| 0.86.0 `docs/extensions.md` `before_agent_start`：优先修改 `systemPromptOptions.sections`，避免完整 prompt 替换；0.86.1 同文件 blob 未变 | 原代码每轮返回完整 `event.systemPrompt` | 改为维护 `ssh_mode` section；保留旧 Pi fallback | `npm test` + Pi 0.86.1 loader smoke |
| 0.86.0 changelog `user_bash` fail-closed | 本仓库未注册 `user_bash` | 不引入无关 handler，故不受此 breaking change 影响 | `index.ts` 审查 |
| 0.86.1 release/changelog：仅 provider、compile cache、bug/clipboard 修复，无新的插件契约 | 无 0.86.1 特定 API 缺口 | 记录为兼容目标并用当前 loader 验证 | `pi --version` = `0.86.1`；smoke test |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Package smoke test 首次直接 spawn Windows shim `pi` 失败 (`ENOENT`/`EINVAL`) | 2 | 改为 Windows `cmd.exe /c call pi.cmd`，测试通过 |

## Decisions Made
| Decision | Reason |
|---|---|
| 不升级 `engines.node` | 上游 Pi package 文档没有把插件最低 Node 版本作为插件契约；当前 package 可保留较宽的 Node 声明，实际 Pi 0.86.1 host 已验证 |
| 不添加 `constrainedSampling: false` | 所有工具已有对象 TypeBox schema；0.86.0 的 strict-prefer 默认不要求关闭约束 |

## Evidence Links
- Pi v0.86.0 tag: https://github.com/earendil-works/pi/tree/v0.86.0
- Pi v0.86.0 release: https://github.com/earendil-works/pi/releases/tag/v0.86.0
- Pi v0.86.1 release: https://github.com/earendil-works/pi/releases/tag/v0.86.1
- Extensions guide: `packages/coding-agent/docs/extensions.md`
- Package guide: `packages/coding-agent/docs/packages.md`
- Loader: `packages/coding-agent/src/core/extensions/loader.ts`
- Manifest reader: `packages/coding-agent/src/core/pi-manifest.ts`
- Extension API types: `packages/coding-agent/src/core/extensions/types.ts`
- 0.86.x changelog: `packages/coding-agent/CHANGELOG.md`
