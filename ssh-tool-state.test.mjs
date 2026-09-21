import assert from "node:assert/strict";
import { test } from "node:test";
import {
	getSshToolState,
	mergeRegisteredSshTools,
	SSH_TOOL_NAMES,
} from "./ssh-tool-state.js";

test("distinguishes registered SSH tools from active SSH tools", () => {
	const state = getSshToolState(
		[
			{ name: "ssh_activate" },
			{ name: "ssh_status" },
			{ name: "ssh_bash" },
		],
		["read", "ssh_activate"],
	);

	assert.deepEqual(state.registered, ["ssh_activate", "ssh_status", "ssh_bash"]);
	assert.deepEqual(state.active, ["ssh_activate"]);
	assert.deepEqual(state.missingRegistration, ["ssh_deactivate", "ssh_read", "ssh_write", "ssh_edit"]);
	assert.deepEqual(state.inactive, ["ssh_status", "ssh_bash"]);
});

test("merges only registered SSH tools without removing unrelated active tools", () => {
	const next = mergeRegisteredSshTools(
		[{ name: "ssh_activate" }, { name: "ssh_bash" }, { name: "read" }],
		["read", "other_tool", "ssh_activate"],
	);

	assert.deepEqual(next, ["read", "other_tool", "ssh_activate", "ssh_bash"]);
});

test("reports a complete SSH loadout when every SSH tool is registered and active", () => {
	const state = getSshToolState(
		SSH_TOOL_NAMES.map((name) => ({ name })),
		[...SSH_TOOL_NAMES],
	);

	assert.deepEqual(state.registered, [...SSH_TOOL_NAMES]);
	assert.deepEqual(state.active, [...SSH_TOOL_NAMES]);
	assert.deepEqual(state.missingRegistration, []);
	assert.deepEqual(state.inactive, []);
});
