import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import {
	type BashOperations,
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditOperations,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ReadOperations,
	type WriteOperations,
	highlightCode,
} from "@earendil-works/pi-coding-agent";
import { createRemotePathMapper, VIRTUAL_ROOT } from "./path-mapping.js";
import {
	WINDOWS_PLATFORM_MARKER,
	WINDOWS_PLATFORM_PROBE,
	WINDOWS_POWERSHELL_COMMAND,
	createPowerShellRemoteBashScript,
	createPosixRemoteBashScript,
	createSshArgs,
	normalizePowerShellInput,
} from "./ssh-command.js";
import { getSshToolState, mergeRegisteredSshTools } from "./ssh-tool-state.js";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

type SshProfile = {
	name: string;
	remote: string;
	cwd?: string;
};

type RemotePlatform = "posix" | "windows-powershell";

type ActiveSshTarget = {
	name: string;
	remote: string;
	remoteCwd: string;
	remoteHome: string;
	platform: RemotePlatform;
};

type RemotePathMapper = {
	toCorePath: (inputPath: string) => string;
	toRemotePath: (absolutePath: string) => string;
};

type SshExecOptions = {
	stdin?: string | Buffer;
	signal?: AbortSignal;
	onStdoutData?: (data: Buffer) => void;
	onStderrData?: (data: Buffer) => void;
	timeoutSeconds?: number;
};

const SSH_STATUS_KEY = "ssh-tools";
const SSH_CONFIG_PATH = join(homedir(), ".ssh", "config");

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function lastNonEmptyLine(value: string): string {
	return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

function parseSshConfigProfiles(): SshProfile[] {
	if (!existsSync(SSH_CONFIG_PATH)) {
		return [];
	}

	const text = readFileSync(SSH_CONFIG_PATH, "utf8");
	const profiles = new Map<string, SshProfile>();

	for (const rawLine of text.split("\n")) {
		const withoutComment = rawLine.replace(/\s+#.*$/, "").trim();
		if (!withoutComment) continue;

		const match = withoutComment.match(/^Host\s+(.+)$/i);
		if (!match) continue;

		const aliases = match[1]
			.split(/\s+/)
			.map((alias) => alias.trim())
			.filter(Boolean)
			.filter((alias) => !alias.includes("*") && !alias.includes("?") && !alias.startsWith("!"));

		for (const alias of aliases) {
			if (!profiles.has(alias)) {
				profiles.set(alias, { name: alias, remote: alias });
			}
		}
	}

	return Array.from(profiles.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeTargetArg(arg: string, profiles: SshProfile[]): SshProfile {
	const trimmed = arg.trim();
	const matchedProfile = profiles.find((profile) => profile.name === trimmed);
	if (matchedProfile) {
		return matchedProfile;
	}

	const separatorIndex = trimmed.indexOf(":");
	if (separatorIndex > 0) {
		return {
			name: trimmed,
			remote: trimmed.slice(0, separatorIndex),
			cwd: trimmed.slice(separatorIndex + 1),
		};
	}

	return { name: trimmed, remote: trimmed };
}

function inferImageMimeType(path: string): string | null {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		default:
			return null;
	}
}

function sshExec(remote: string, command: string, options: SshExecOptions = {}) {
	return new Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null }>((resolve, reject) => {
		const child = spawn("ssh", createSshArgs(remote, command), { stdio: ["pipe", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timedOut = false;
		const timer =
			typeof options.timeoutSeconds === "number" && options.timeoutSeconds > 0
				? setTimeout(() => {
						timedOut = true;
						child.kill();
					}, options.timeoutSeconds * 1000)
				: undefined;

		const cleanup = () => {
			if (timer) clearTimeout(timer);
			if (options.signal) options.signal.removeEventListener("abort", onAbort);
		};

		const onAbort = () => {
			child.kill();
		};

		child.stdout.on("data", (data: Buffer) => {
			stdoutChunks.push(data);
			options.onStdoutData?.(data);
		});
		child.stderr.on("data", (data: Buffer) => {
			stderrChunks.push(data);
			options.onStderrData?.(data);
		});
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (exitCode) => {
			cleanup();
			if (options.signal?.aborted) {
				reject(new Error("aborted"));
				return;
			}
			if (timedOut) {
				reject(new Error(`timeout:${options.timeoutSeconds}`));
				return;
			}
			resolve({
				stdout: Buffer.concat(stdoutChunks),
				stderr: Buffer.concat(stderrChunks),
				exitCode,
			});
		});

		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		if (options.stdin !== undefined) {
			child.stdin.write(options.stdin);
		}
		child.stdin.end();
	});
}

async function sshOk(remote: string, command: string, options: SshExecOptions = {}): Promise<Buffer> {
	const { stdout, stderr, exitCode } = await sshExec(remote, command, options);
	if (exitCode !== 0) {
		const errorText = stderr.toString("utf8").trim() || stdout.toString("utf8").trim() || "unknown ssh error";
		throw new Error(`SSH failed (${exitCode}): ${errorText}`);
	}
	return stdout;
}

function sshPowerShellExec(
	remote: string,
	script: string,
	options: Omit<SshExecOptions, "stdin"> = {},
) {
	return sshExec(remote, WINDOWS_POWERSHELL_COMMAND, {
		...options,
		stdin: normalizePowerShellInput(script),
	});
}

async function sshPowerShellOk(
	remote: string,
	script: string,
	options: Omit<SshExecOptions, "stdin"> = {},
): Promise<Buffer> {
	const { stdout, stderr, exitCode } = await sshPowerShellExec(remote, script, options);
	if (exitCode !== 0) {
		const errorText = stderr.toString("utf8").trim() || stdout.toString("utf8").trim() || "unknown ssh error";
		throw new Error(`SSH failed (${exitCode}): ${errorText}`);
	}
	return stdout;
}

async function detectRemotePlatform(remote: string): Promise<RemotePlatform> {
	try {
		const stdout = await sshOk(remote, WINDOWS_PLATFORM_PROBE, { timeoutSeconds: 5 });
		if (stdout.toString("utf8").includes(WINDOWS_PLATFORM_MARKER)) {
			return "windows-powershell";
		}
	} catch {
		// The default shell may not be Windows. Try an explicit PowerShell probe before POSIX.
	}

	try {
		const stdout = await sshPowerShellOk(remote, `Write-Output '${WINDOWS_PLATFORM_MARKER}'`, {
			timeoutSeconds: 5,
		});
		if (stdout.toString("utf8").includes(WINDOWS_PLATFORM_MARKER)) {
			return "windows-powershell";
		}
	} catch {
		// Not a Windows target with PowerShell available. Try POSIX next.
	}

	try {
		const stdout = await sshOk(
			remote,
			`printf '__PI_SSH_PLATFORM=posix:%s__\\n' "$(uname -s 2>/dev/null || echo unknown)"`,
			{ timeoutSeconds: 5 },
		);
		if (stdout.toString("utf8").includes("__PI_SSH_PLATFORM=posix:")) {
			return "posix";
		}
	} catch {
		// Fall through to the historical behavior.
	}

	return "posix";
}

async function resolveRemoteLocation(
	profile: SshProfile,
	platform: RemotePlatform,
): Promise<{ remoteCwd: string; remoteHome: string }> {
	const remoteHomeCommand =
		platform === "windows-powershell" ? "[Environment]::GetFolderPath('UserProfile')" : `printf '%s' "$HOME"`;
	const remoteHomeOutput =
		platform === "windows-powershell"
			? await sshPowerShellOk(profile.remote, remoteHomeCommand)
			: await sshOk(profile.remote, remoteHomeCommand);
	const remoteHome = lastNonEmptyLine(remoteHomeOutput.toString("utf8"));

	const remoteCwdCommand =
		platform === "windows-powershell"
			? profile.cwd?.trim()
				? `Set-Location -LiteralPath ${powershellQuote(profile.cwd.trim())}; (Get-Location).Path`
				: "(Get-Location).Path"
			: profile.cwd?.trim()
				? `cd -- ${shellQuote(profile.cwd.trim())} && pwd`
				: "pwd";
	const remoteCwdOutput =
		platform === "windows-powershell"
			? await sshPowerShellOk(profile.remote, remoteCwdCommand)
			: await sshOk(profile.remote, remoteCwdCommand);
	const remoteCwd = lastNonEmptyLine(remoteCwdOutput.toString("utf8"));
	if (!remoteCwd) throw new Error("Could not determine the remote working directory");
	return { remoteCwd, remoteHome };
}

function restoreVirtualPathInResult(result: any, corePath: string, originalPath: string): any {
	if (!corePath.startsWith(`${VIRTUAL_ROOT}/`)) return result;
	const replace = (value: unknown) => (typeof value === "string" ? value.replaceAll(corePath, originalPath) : value);
	const content = Array.isArray(result?.content)
		? result.content.map((block: any) => (block?.type === "text" ? { ...block, text: replace(block.text) } : block))
		: result?.content;
	const details = result?.details && typeof result.details === "object"
		? { ...result.details, diff: replace(result.details.diff), patch: replace(result.details.patch) }
		: result?.details;
	return { ...result, content, details };
}

function createRemoteReadOps(target: ActiveSshTarget, pathMapper: RemotePathMapper): ReadOperations {
	return {
		readFile: (absolutePath) => {
			const remotePath = pathMapper.toRemotePath(absolutePath);
			if (target.platform === "windows-powershell") {
				return sshPowerShellOk(
					target.remote,
					`$p=${powershellQuote(remotePath)}; $bytes=[System.IO.File]::ReadAllBytes($p); [Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length)`,
				);
			}
			return sshOk(target.remote, `cat -- ${shellQuote(remotePath)}`);
		},
		access: (absolutePath) => {
			const remotePath = pathMapper.toRemotePath(absolutePath);
			if (target.platform === "windows-powershell") {
				return sshPowerShellOk(
					target.remote,
					`if (-not (Test-Path -LiteralPath ${powershellQuote(remotePath)} -PathType Leaf)) { exit 1 }`,
				).then(() => {});
			}
			return sshOk(target.remote, `test -r ${shellQuote(remotePath)}`).then(() => {});
		},
		detectImageMimeType: async (absolutePath) => inferImageMimeType(pathMapper.toRemotePath(absolutePath)),
	};
}

function createRemoteWriteOps(target: ActiveSshTarget, pathMapper: RemotePathMapper): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			const remotePath = pathMapper.toRemotePath(absolutePath);
			if (target.platform === "windows-powershell") {
				const base64Content = Buffer.from(content, "utf8").toString("base64");
				const script = [
					`$p=${powershellQuote(remotePath)}`,
					`$dir=Split-Path -Parent $p; if ($dir) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }`,
					`$b64=${powershellQuote(base64Content)}`,
					`$bytes=[Convert]::FromBase64String($b64)`,
					`[System.IO.File]::WriteAllBytes($p,$bytes)`,
				].join("\n");
				await sshPowerShellOk(target.remote, script);
				return;
			}
			await sshOk(target.remote, `cat > ${shellQuote(remotePath)}`, { stdin: content });
		},
		mkdir: (dir) => {
			const remoteDir = pathMapper.toRemotePath(dir);
			if (target.platform === "windows-powershell") {
				return sshPowerShellOk(
					target.remote,
					`[System.IO.Directory]::CreateDirectory(${powershellQuote(remoteDir)}) | Out-Null`,
				).then(() => {});
			}
			return sshOk(target.remote, `mkdir -p -- ${shellQuote(remoteDir)}`).then(() => {});
		},
	};
}

function createRemoteEditOps(target: ActiveSshTarget, pathMapper: RemotePathMapper): EditOperations {
	const readOps = createRemoteReadOps(target, pathMapper);
	const writeOps = createRemoteWriteOps(target, pathMapper);
	return {
		readFile: readOps.readFile,
		writeFile: writeOps.writeFile,
		access: (absolutePath) => {
			const remotePath = pathMapper.toRemotePath(absolutePath);
			if (target.platform === "windows-powershell") {
				return sshPowerShellOk(
					target.remote,
					`if (-not (Test-Path -LiteralPath ${powershellQuote(remotePath)} -PathType Leaf)) { exit 1 }; $item=Get-Item -LiteralPath ${powershellQuote(remotePath)}; if ($item.IsReadOnly) { exit 1 }`,
				).then(() => {});
			}
			return sshOk(target.remote, `test -r ${shellQuote(remotePath)} && test -w ${shellQuote(remotePath)}`).then(
				() => {},
			);
		},
	};
}

function createRemoteBashOps(target: ActiveSshTarget): BashOperations {
	return {
		exec: async (command, _controllerCwd, { onData, signal, timeout }) => {
			if (target.platform === "windows-powershell") {
				const script = createPowerShellRemoteBashScript(target.remoteCwd, command);
				const { exitCode } = await sshPowerShellExec(target.remote, script, {
					signal,
					timeoutSeconds: timeout,
					onStdoutData: onData,
					onStderrData: onData,
				});
				return { exitCode };
			}

			const script = createPosixRemoteBashScript(target.remoteCwd, command);
			const { exitCode } = await sshExec(target.remote, "exec bash -se", {
				stdin: script,
				signal,
				timeoutSeconds: timeout,
				onStdoutData: onData,
				onStderrData: onData,
			});
			return { exitCode };
		},
	};
}

function ensureSshTools(pi: ExtensionAPI) {
	const allTools = pi.getAllTools();
	const currentActiveTools = pi.getActiveTools();
	const nextActiveTools = mergeRegisteredSshTools(allTools, currentActiveTools);
	const changed =
		nextActiveTools.length !== currentActiveTools.length ||
		nextActiveTools.some((name, index) => name !== currentActiveTools[index]);
	if (changed) {
		pi.setActiveTools(nextActiveTools);
	}
	return getSshToolState(allTools, nextActiveTools);
}

export default function sshToolsExtension(pi: ExtensionAPI) {
	let activeTarget: ActiveSshTarget | null = null;
	const localCwd = process.cwd();

	const readBase = createReadToolDefinition(localCwd);
	const writeBase = createWriteToolDefinition(localCwd);
	const editBase = createEditToolDefinition(localCwd);
	const bashBase = createBashToolDefinition(localCwd);

	const requireActiveTarget = (): ActiveSshTarget => {
		if (!activeTarget) {
			throw new Error("SSH mode is off. Call ssh_activate with a target first.");
		}
		return activeTarget;
	};

	const refreshProfiles = () => parseSshConfigProfiles();

	const updateStatus = (ctx: ExtensionContext | ExtensionCommandContext) => {
		if (!activeTarget) {
			ctx.ui.setStatus(SSH_STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(
			SSH_STATUS_KEY,
			ctx.ui.theme.fg("accent", `SSH ${activeTarget.name}:${activeTarget.remoteCwd}`),
		);
	};

	const activate = async (profile: SshProfile, ctx: ExtensionContext | ExtensionCommandContext, notify = true) => {
		const platform = await detectRemotePlatform(profile.remote);
		const activatedLocation = await resolveRemoteLocation(profile, platform);
		activeTarget = {
			name: profile.name,
			remote: profile.remote,
			remoteCwd: activatedLocation.remoteCwd,
			remoteHome: activatedLocation.remoteHome,
			platform,
		};
		ensureSshTools(pi);
		updateStatus(ctx);
		if (notify && ctx.hasUI) {
			ctx.ui.notify(`SSH mode on: ${activeTarget.name} (${activeTarget.remoteCwd}, ${activeTarget.platform})`, "info");
		}
		return activeTarget;
	};

	const deactivate = (ctx: ExtensionContext | ExtensionCommandContext, notify = true) => {
		activeTarget = null;
		updateStatus(ctx);
		if (notify && ctx.hasUI) {
			ctx.ui.notify("SSH mode off", "info");
		}
	};

	const statusDetails = () => ({
		active: activeTarget !== null,
		target: activeTarget?.name,
		remote: activeTarget?.remote,
		cwd: activeTarget?.remoteCwd,
		platform: activeTarget?.platform,
		tools: getSshToolState(pi.getAllTools(), pi.getActiveTools()),
	});


	pi.registerTool({
		name: "ssh_activate",
		label: "ssh_activate",
		description: "Activate SSH mode for a target using the same syntax as /ssh <host>[:path].",
		promptSnippet: "Activate the remote SSH toolset for a target host",
		promptGuidelines: ["Call ssh_activate with an explicit target before using ssh_read, ssh_write, ssh_edit, or ssh_bash."],
		parameters: Type.Object({
			target: Type.Optional(Type.String({ description: "SSH target using /ssh syntax, for example host or user@host:/path" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const profiles = refreshProfiles();
			let target = typeof params.target === "string" ? params.target.trim() : "";

			if (!target) {
				if (!ctx.hasUI || profiles.length === 0) {
					throw new Error('ssh_activate requires an explicit target in non-interactive contexts. Use ssh_activate({ target: "host[:path]" }).');
				}
				const picked = await ctx.ui.select("SSH target", profiles.map((profile) => profile.name));
				if (!picked) {
					throw new Error("SSH activation cancelled");
				}
				target = picked;
			}

			const activated = await activate(normalizeTargetArg(target, profiles), ctx);
			return {
				content: [{ type: "text", text: `SSH mode on: ${activated.name} (${activated.remote}:${activated.remoteCwd}, ${activated.platform})` }],
				details: statusDetails(),
			};
		},
		renderCall(args, theme) {
			const target = typeof args?.target === "string" && args.target.trim() ? args.target : "picker";
			return new Text(`${theme.fg("toolTitle", theme.bold("ssh_activate"))} ${theme.fg("accent", target)}`, 0, 0);
		},
	});

	pi.registerTool({
		name: "ssh_status",
		label: "ssh_status",
		description: "Report whether SSH mode is active and which target/cwd is selected.",
		parameters: Type.Object({}),
		async execute() {
			const details = statusDetails();
			const toolStatus = [
				`registered=${details.tools.registered.join(",") || "none"}`,
				`active=${details.tools.active.join(",") || "none"}`,
				`missing=${details.tools.missingRegistration.join(",") || "none"}`,
				`inactive=${details.tools.inactive.join(",") || "none"}`,
			].join("; ");
			const modeStatus = details.active
				? `SSH mode active: ${details.target} (${details.remote}:${details.cwd}, ${details.platform})`
				: "SSH mode is off";
			return { content: [{ type: "text", text: `${modeStatus}; ${toolStatus}` }], details };
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("ssh_status")), 0, 0);
		},
	});

	pi.registerTool({
		name: "ssh_deactivate",
		label: "ssh_deactivate",
		description: "Deactivate SSH mode. Remote SSH tools remain available and will fail clearly until ssh_activate is called again.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const wasActive = activeTarget !== null;
			deactivate(ctx);
			return {
				content: [{ type: "text", text: wasActive ? "SSH mode off" : "SSH mode was already off" }],
				details: statusDetails(),
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("ssh_deactivate")), 0, 0);
		},
	});

	pi.registerTool({
		name: "ssh_read",
		label: "ssh_read",
		description: "Read a file on the active SSH host. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Read file contents on the active SSH host",
		promptGuidelines: ["Use ssh_read when the task is on the active SSH host instead of the local machine."],
		parameters: readBase.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const pathMapper = createRemotePathMapper(localCwd, target.remoteCwd, target.remoteHome, target.platform);
			const tool = createReadToolDefinition(localCwd, { operations: createRemoteReadOps(target, pathMapper) });
			const transformedParams = { ...params, path: pathMapper.toCorePath(params.path) };
			return tool.execute(toolCallId, transformedParams, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_read"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: readBase.renderResult,
	});

	pi.registerTool({
		name: "ssh_write",
		label: "ssh_write",
		description: "Write a text file on the active SSH host. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Create or overwrite files on the active SSH host",
		promptGuidelines: ["Use ssh_write only for new files or full rewrites on the active SSH host."],
		parameters: writeBase.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const pathMapper = createRemotePathMapper(localCwd, target.remoteCwd, target.remoteHome, target.platform);
			const corePath = pathMapper.toCorePath(params.path);
			const tool = createWriteToolDefinition(localCwd, { operations: createRemoteWriteOps(target, pathMapper) });
			const transformedParams = { ...params, path: corePath };
			const result = await tool.execute(toolCallId, transformedParams, signal, onUpdate, ctx);
			return restoreVirtualPathInResult(result, corePath, params.path);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_write"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: writeBase.renderResult,
	});

	pi.registerTool({
		name: "ssh_edit",
		label: "ssh_edit",
		description: "Edit a file on the active SSH host using exact text replacement. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Make precise file edits on the active SSH host",
		promptGuidelines: [
			"Use ssh_edit for precise remote changes.",
			"Each edits[].oldText must match exactly on the remote file.",
		],
		parameters: editBase.parameters,
		prepareArguments: editBase.prepareArguments,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const pathMapper = createRemotePathMapper(localCwd, target.remoteCwd, target.remoteHome, target.platform);
			const corePath = pathMapper.toCorePath(params.path);
			const tool = createEditToolDefinition(localCwd, { operations: createRemoteEditOps(target, pathMapper) });
			const transformedParams = { ...params, path: corePath };
			const result = await tool.execute(toolCallId, transformedParams, signal, onUpdate, ctx);
			return restoreVirtualPathInResult(result, corePath, params.path);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_edit"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: editBase.renderResult,
	});

	pi.registerTool({
		name: "ssh_bash",
		label: "ssh_bash",
		description: "Execute a shell command on the active SSH host in the active remote working directory. POSIX targets use bash; Windows targets use PowerShell syntax.",
		promptSnippet: "Execute shell commands on the active SSH host",
		promptGuidelines: ["Use ssh_bash when the command must run on the active SSH host rather than locally. Use PowerShell syntax when ssh_status reports platform windows-powershell."],
		parameters: bashBase.parameters,
		async execute(toolCallId, params, signal, onUpdate, _ctx) {
			const target = requireActiveTarget();
			const tool = createBashToolDefinition(target.remoteCwd, { operations: createRemoteBashOps(target) });
			// Do not forward Pi's context: Pi 0.86.x prefers ctx.cwd over the definition cwd.
			return tool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const command = typeof args?.command === "string" ? args.command : "...";
			const targetLabel = activeTarget ? `${activeTarget.name} (${activeTarget.remote}:${activeTarget.remoteCwd})` : "inactive";
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				`${theme.fg("toolTitle", theme.bold("ssh_bash"))} ${theme.fg("muted", `[${targetLabel}]`)}\n${highlightCode(command, "bash").join("\n")}`,
			);
			return text;
		},
		renderResult: bashBase.renderResult,
	});

	pi.registerCommand("ssh", {
		description: "Toggle remote SSH tools: /ssh, /ssh off, /ssh status, /ssh <host>[:/path]",
		getArgumentCompletions: (prefix) => {
			const options = ["off", "status", ...refreshProfiles().map((profile) => profile.name)];
			const filtered = options.filter((option) => option.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((option) => ({ value: option, label: option })) : null;
		},
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const input = args.trim();
			const profiles = refreshProfiles();

			if (input === "status") {
				const details = statusDetails();
				const modeStatus = details.active
					? `SSH mode: ${details.target} (${details.remote}:${details.cwd}, ${details.platform})`
					: "SSH mode is off";
				const toolStatus = `tools registered=${details.tools.registered.join(",") || "none"}; active=${details.tools.active.join(",") || "none"}; missing=${details.tools.missingRegistration.join(",") || "none"}; inactive=${details.tools.inactive.join(",") || "none"}`;
				ctx.ui.notify(`${modeStatus}; ${toolStatus}`, "info");
				return;
			}

			if (input === "off") {
				if (!activeTarget) {
					ctx.ui.notify("SSH mode is already off", "info");
					return;
				}
				deactivate(ctx);
				return;
			}

			if (!input) {
				if (profiles.length === 0) {
					ctx.ui.notify("No SSH hosts found in ~/.ssh/config. Use /ssh <host>[:/path]", "warning");
					return;
				}
				const items = [...(activeTarget ? ["off"] : []), ...profiles.map((profile) => profile.name)];
				const picked = await ctx.ui.select("SSH target", items);
				if (!picked) {
					return;
				}
				if (picked === "off") {
					deactivate(ctx);
					return;
				}
				await activate(normalizeTargetArg(picked, profiles), ctx);
				return;
			}

			await activate(normalizeTargetArg(input, profiles), ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		activeTarget = null;
		ensureSshTools(pi);
		updateStatus(ctx);
	});

	pi.on("session_tree", () => {
		ensureSshTools(pi);
	});

	const buildSshPromptSection = (
		target: ActiveSshTarget,
		toolState: { missingRegistration: string[]; inactive: string[] },
	) => {
		const shellGuidance =
			target.platform === "windows-powershell"
				? "ssh_bash runs in Windows PowerShell on this target; use PowerShell syntax unless explicitly invoking cmd.exe or another shell."
				: "ssh_bash runs through bash on this target.";
		const registrationWarning =
			toolState.missingRegistration.length > 0
				? `SSH tool registration is incomplete; missing: ${toolState.missingRegistration.join(", ")}. Do not substitute local tools; reload the extension.`
				: toolState.inactive.length > 0
					? `SSH tools are registered but inactive: ${toolState.inactive.join(", ")}. Check the Pi tool allowlist or another tool preset before using remote work.`
					: undefined;
		return [
			"SSH mode is active for this turn.",
			`Remote host: ${target.remote}`,
			`Remote platform: ${target.platform}`,
			`Remote working directory: ${target.remoteCwd}`,
			shellGuidance,
			"Use ssh_read, ssh_write, ssh_edit, and ssh_bash for remote work. Local read/write/edit/bash still operate on the local machine.",
			registrationWarning,
		].filter(Boolean).join("\n");
	};

	pi.on("before_agent_start", (event) => {
		const toolState = ensureSshTools(pi);
		const sections = event.systemPromptOptions?.sections;
		if (sections) {
			if (activeTarget) {
				sections.ssh_mode = buildSshPromptSection(activeTarget, toolState);
			} else {
				delete sections.ssh_mode;
			}
			return;
		}

		// Keep compatibility with older Pi releases that do not expose structured prompt sections.
		if (activeTarget) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${buildSshPromptSection(activeTarget, toolState)}`,
			};
		}
	});
}
