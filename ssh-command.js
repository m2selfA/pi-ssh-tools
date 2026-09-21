export const WINDOWS_PLATFORM_MARKER = "__PI_SSH_PLATFORM=windows__";
export const WINDOWS_PLATFORM_PROBE = `cmd.exe /d /c echo ${WINDOWS_PLATFORM_MARKER}`;
export const WINDOWS_POWERSHELL_COMMAND = "powershell.exe -NoLogo -NoProfile -NonInteractive -Command -";

export function createSshArgs(remote, command) {
	return ["-x", remote, command];
}

export function normalizePowerShellInput(script) {
	return script.endsWith("\n") ? script : `${script}\n`;
}

function shellQuote(value) {
	return `'${value.replaceAll("'", `\'"\'"\'`)}'`;
}

function powershellQuote(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

export function createPosixRemoteBashScript(remoteCwd, command) {
	return `cd ${shellQuote(remoteCwd)}\n${command}\n`;
}

export function createPowerShellRemoteBashScript(remoteCwd, command) {
	return `Set-Location -LiteralPath ${powershellQuote(remoteCwd)}\n${command}\nif ($global:LASTEXITCODE -is [int]) { exit $global:LASTEXITCODE } else { exit 0 }\n`;
}
