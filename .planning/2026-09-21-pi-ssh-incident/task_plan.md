# pi-ssh-tools 工具挂载与远端 cwd 故障调研

## Goal
结合用户提供的证据、contextX 外部资料和 GitHub MCP 源码，确认“工具注册表未注入”和“Windows 本地 cwd 传给 Linux 远端”是否为两个独立故障，并形成可执行、分层的修复方案。

## Phases

### Phase 1: 复核本地实现与上游契约
**Status:** complete
- [x] 阅读当前 `pi-ssh-tools` 的工具注册、active tools、cwd 和 SSH command 构造。
- [x] 使用 GitHub MCP 阅读 pi 的扩展加载/工具挂载生命周期。
- [x] 使用 contextX 搜索相关 harness/插件注入故障资料。

### Phase 2: 建立证据矩阵
**Status:** complete
- [x] 将工具注入缺失与远端 cwd 错误分别映射到可观测证据。
- [x] 区分 harness 会话级故障、扩展运行时故障、SSH 连接/远端故障。
- [x] 对比官方 `tools.ts`、`ssh.ts`、`pi-loaded-tools`、`pi-cwd` 和 `pi-ssh-remote` 的处理模式。

### Phase 3: 输出分层解决方案
**Status:** complete
- [x] 给出当前会话恢复、harness 永久修复、插件代码修复和回归测试方案。
- [x] 说明验证命令、成功判据和残余风险。

### Phase 4: 实施 P1 修复与验证
**Status:** complete
- [x] `ssh_bash` 始终使用检测到的远端 cwd，不再把控制端 cwd 传入远端脚本。
- [x] 增加 SSH 工具 registry/active loadout 诊断，并在 session/before-agent 生命周期中恢复已注册工具。
- [x] 增加远端脚本和工具状态回归测试，纳入标准 `npm test`。
- [x] 完成 package contract、Pi loader smoke、打包清单和 diff 检查。

## Next Step
全部完成；稳定原生工具路由（P2）属于后续架构演进，当前不阻塞本次修复提交。真实 SSH 目标端到端操作仍是残余风险。

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|

## Decisions Made
| Decision | Reason |
|---|---|
