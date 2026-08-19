export const WINDOWS_PLATFORM_MARKER = "__PI_SSH_PLATFORM=windows__";
export const WINDOWS_PLATFORM_PROBE = `cmd.exe /d /c echo ${WINDOWS_PLATFORM_MARKER}`;
export const WINDOWS_POWERSHELL_COMMAND = "powershell.exe -NoLogo -NoProfile -NonInteractive -Command -";

export function createSshArgs(remote, command) {
	return ["-x", remote, command];
}

export function normalizePowerShellInput(script) {
	return script.endsWith("\n") ? script : `${script}\n`;
}
