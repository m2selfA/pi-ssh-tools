import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertSshTargetAllowed,
	classifySshTarget,
	extractSshHostname,
	isLoopbackHostname,
} from "./ssh-target-policy.js";

test("extracts SSH hostnames from user and bracketed IPv6 targets", () => {
	assert.equal(extractSshHostname("user@localhost"), "localhost");
	assert.equal(extractSshHostname("user@localhost:/work"), "localhost");
	assert.equal(extractSshHostname("user@localhost:22"), "localhost");
	assert.equal(extractSshHostname("user@[::1]"), "::1");
	assert.equal(extractSshHostname("server.example"), "server.example");
});

test("recognizes loopback names, IPv4 127/8, and IPv6 loopback", () => {
	for (const value of [
		"localhost",
		"LOCALHOST.",
		"api.localhost",
		"127.0.0.1",
		"127.42.9.7",
		"::1",
		"[::1]",
		"0:0:0:0:0:0:0:1",
		"::ffff:127.0.0.1",
	]) {
		assert.equal(isLoopbackHostname(value), true, value);
	}
	assert.equal(isLoopbackHostname("127.999.0.1"), false);
	assert.equal(isLoopbackHostname("host.docker.internal"), false);
});

test("classifies an SSH config alias by its resolved HostName", () => {
	assert.deepEqual(
		classifySshTarget("workstation", { resolvedHost: "localhost", localHostnames: ["controller"] }),
		{ kind: "loopback", hostname: "localhost" },
	);
	assert.deepEqual(
		classifySshTarget("self-test", { resolvedHost: "127.0.0.42", localHostnames: ["controller"] }),
		{ kind: "loopback", hostname: "127.0.0.42" },
	);
});

test("classifies the controller hostname but leaves real remote hosts alone", () => {
	assert.deepEqual(
		classifySshTarget("user@controller", { localHostnames: ["controller"] }),
		{ kind: "local-hostname", hostname: "controller" },
	);
	assert.equal(classifySshTarget("user@compute-01", { localHostnames: ["controller"] }), null);
});

test("blocks local SSH activation with an actionable local-tool recovery", () => {
	assert.throws(
		() => assertSshTargetAllowed("user@127.0.0.1:/work", { localHostnames: [] }),
		/Use the native local read\/write\/edit\/bash tools \(and powershell where available\).*allowLocalTarget=true/,
	);
});

test("requires an explicit override for intentional local SSH tests", () => {
	assert.deepEqual(
		assertSshTargetAllowed("localhost:/work", { allowLocalTarget: true, localHostnames: [] }),
		{ kind: "loopback", hostname: "localhost" },
	);
});
