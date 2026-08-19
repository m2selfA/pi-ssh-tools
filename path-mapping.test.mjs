import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { createRemotePathMapper, VIRTUAL_ROOT } from "./path-mapping.js";

const localCwd = process.cwd();

function localPath(corePath) {
	return resolve(localCwd, corePath);
}

test("maps a POSIX remote absolute path through a Windows local cwd", () => {
	const mapper = createRemotePathMapper(localCwd, "/Users/shark", "/Users/shark", "posix");
	const corePath = mapper.toCorePath("/Users/shark/Library/LaunchAgents/agent.plist");

	assert.equal(corePath, "Library/LaunchAgents/agent.plist");
	assert.equal(mapper.toRemotePath(localPath(corePath)), "/Users/shark/Library/LaunchAgents/agent.plist");
});

test("maps relative POSIX paths and normalizes traversal", () => {
	const mapper = createRemotePathMapper(localCwd, "/Users/shark/project", "/Users/shark", "posix");

	const relative = mapper.toCorePath("src/../config.toml");
	assert.equal(relative, "config.toml");
	assert.equal(mapper.toRemotePath(localPath(relative)), "/Users/shark/project/config.toml");

	const outside = mapper.toCorePath("../shared/config.toml");
	assert.equal(mapper.toRemotePath(localPath(outside)), "/Users/shark/shared/config.toml");
});

test("maps POSIX absolute paths outside the active cwd through a virtual path", () => {
	const mapper = createRemotePathMapper(localCwd, "/Users/shark/project", "/Users/shark", "posix");
	const corePath = mapper.toCorePath("/etc/profile");

	assert.ok(corePath.startsWith(`${VIRTUAL_ROOT}/absolute/posix/`));
	assert.equal(mapper.toRemotePath(localPath(corePath)), "/etc/profile");
});

test("does not confuse a real remote path named like the virtual root", () => {
	const mapper = createRemotePathMapper(localCwd, "/Users/shark", "/Users/shark", "posix");
	const input = `${VIRTUAL_ROOT}/posix/file.txt`;
	const corePath = mapper.toCorePath(input);

	assert.ok(corePath.startsWith(`${VIRTUAL_ROOT}/relative/`));
	assert.equal(mapper.toRemotePath(localPath(corePath)), `/Users/shark/${input}`);
});

test("expands remote tilde paths using the detected remote home", () => {
	const mapper = createRemotePathMapper(localCwd, "/Users/shark/project", "/Users/shark", "posix");
	const corePath = mapper.toCorePath("~/.ssh/config");

	assert.ok(corePath.startsWith(`${VIRTUAL_ROOT}/absolute/posix/`));
	assert.equal(mapper.toRemotePath(localPath(corePath)), "/Users/shark/.ssh/config");
});

test("maps Windows PowerShell remote paths independently of the local path separator", () => {
	const mapper = createRemotePathMapper(
		localCwd,
		"C:\\Users\\shark\\project",
		"C:\\Users\\shark",
		"windows-powershell",
	);
	const corePath = mapper.toCorePath("C:\\Users\\shark\\project\\src\\main.ts");

	assert.equal(corePath, "src/main.ts");
	assert.equal(mapper.toRemotePath(localPath(corePath)), "C:/Users/shark/project/src/main.ts");

	const outside = mapper.toCorePath("C:\\Windows\\Temp\\probe.txt");
	assert.ok(outside.startsWith(`${VIRTUAL_ROOT}/absolute/windows/drive-C/`));
	assert.equal(mapper.toRemotePath(localPath(outside)), "C:/Windows/Temp/probe.txt");
});
