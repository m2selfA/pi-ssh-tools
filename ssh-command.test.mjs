import assert from "node:assert/strict";
import { test } from "node:test";
import {
	WINDOWS_PLATFORM_MARKER,
	WINDOWS_PLATFORM_PROBE,
	WINDOWS_POWERSHELL_COMMAND,
	createSshArgs,
	normalizePowerShellInput,
} from "./ssh-command.js";

test("programmatic SSH commands disable X11 forwarding", () => {
	assert.deepEqual(createSshArgs("imini", "pwd"), ["-x", "imini", "pwd"]);
});

test("Windows platform probe does not invoke POSIX utilities", () => {
	assert.equal(WINDOWS_PLATFORM_PROBE, `cmd.exe /d /c echo ${WINDOWS_PLATFORM_MARKER}`);
	assert.doesNotMatch(WINDOWS_PLATFORM_PROBE, /printf|uname/);
});

test("Windows commands are sent to an explicit noninteractive PowerShell", () => {
	assert.equal(WINDOWS_POWERSHELL_COMMAND, "powershell.exe -NoLogo -NoProfile -NonInteractive -Command -");
});

test("PowerShell scripts always terminate stdin input with a newline", () => {
	assert.equal(normalizePowerShellInput("Write-Output 'ok'"), "Write-Output 'ok'\n");
	assert.equal(normalizePowerShellInput("Write-Output 'ok'\n"), "Write-Output 'ok'\n");
});
