import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const piPeerPackages = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
];

function findPiCommand() {
	const lookup = process.platform === "win32" ? "where.exe" : "which";
	const result = spawnSync(lookup, ["pi"], { encoding: "utf8" });
	if (result.status !== 0 || result.error) return undefined;
	const candidate = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	if (!candidate) return undefined;
	if (process.platform === "win32" && existsSync(`${candidate}.cmd`)) return `${candidate}.cmd`;
	return candidate;
}

test("declares a loadable Pi extension entry", () => {
	assert.deepEqual(packageJson.pi?.extensions, ["./index.ts"]);
	assert.ok(existsSync(resolve(root, packageJson.pi.extensions[0])));
	assert.ok(packageJson.files.includes("index.ts"));
});

test("keeps Pi-provided runtime modules as peer dependencies", () => {
	for (const packageName of piPeerPackages) {
		assert.equal(packageJson.peerDependencies?.[packageName], "*");
		assert.equal(packageJson.dependencies?.[packageName], undefined);
		assert.equal(packageJson.bundledDependencies?.includes(packageName) ?? false, false);
	}
});

test("publishes documentation referenced by the package", () => {
	assert.ok(packageJson.files.includes("docs"));
	assert.ok(existsSync(resolve(root, "docs", "INTEGRATION_BOUNDARY.md")));
});

const piCommand = findPiCommand();
test(
	"loads through the Pi extension loader and registers its command",
	{ skip: piCommand ? false : "pi executable not found" },
	() => {
		const piArgs = ["-ne", "-e", root, "--mode", "rpc", "--offline", "--no-session"];
		const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : piCommand;
		const commandArgs = process.platform === "win32" ? ["/d", "/c", "call", piCommand, ...piArgs] : piArgs;
		const result = spawnSync(command, commandArgs, {
			cwd: root,
			encoding: "utf8",
			input: '{"id":"plugin-contract","type":"get_commands"}\n',
			timeout: 30_000,
			env: { ...process.env, PI_OFFLINE: "1" },
		});
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		assert.equal(result.error, undefined, output);
		assert.equal(result.status, 0, output);
		assert.doesNotMatch(output, /Failed to load extension|extension_error|object parameter schema/);

		const responses = result.stdout
			.split(/\r?\n/)
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line));
		const response = responses.find((item) => item.id === "plugin-contract" && item.command === "get_commands");
		assert.equal(response?.success, true, output);
		assert.ok(response.data.commands.some((command) => command.name === "ssh"), output);
	},
);
