# Progress Log

## 2026-09-21
- 创建本任务的独立规划目录，保留仓库根目录中上一项工作的旧规划文件不变。
- 通过 GitHub MCP 阅读 `v0.86.0`/`v0.86.1` 的扩展文档、包文档、loader、manifest、类型定义、示例和 changelog；研究结论已写入 `findings.md`。
- 本仓库现状验证：`npm test` 10/10 通过；Node `v24.15.0`，Pi `0.86.1` 可执行。
- 运行 Pi RPC smoke：`pi -ne -e ./index.ts --mode rpc --offline --no-session` + `get_commands` 成功返回 `ssh` 命令，没有 extension load/schema error。
- 初审发现三项改进：使用 0.86.0 结构化 `before_agent_start` section；把 README 引用的 `docs/` 纳入 npm files；修正 `powershell.exe` 被描述为 PowerShell Core 的措辞；补充 package contract 与 Pi loader smoke 测试。
- 已修改 `index.ts`、`package.json`、`README.md`，新增 `plugin-contract.test.mjs`；版本升至 `0.1.5-hackxit.3`。
- 最终验证：Node `v24.15.0`、npm `11.12.1`、Pi `0.86.1`；`npm test` 14/14 通过；JS syntax checks 通过；`npm pack --dry-run` 包含 `index.ts`、`path-mapping.js`、`ssh-command.js` 和 `docs/INTEGRATION_BOUNDARY.md`，不包含规划/审查文件；`git diff --check` 通过；以包根目录 `-e .` 的 Pi RPC smoke exit 0，返回 `ssh` command 且无 extension/schema error。
- 清洁验证序列 `npm test; npm pack --dry-run; git diff --check` 再次通过；package 没有 lockfile，且 `package.json` 的 Pi 核心模块仍只在 `peerDependencies: "*"`。
