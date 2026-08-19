export declare const WINDOWS_PLATFORM_MARKER: string;
export declare const WINDOWS_PLATFORM_PROBE: string;
export declare const WINDOWS_POWERSHELL_COMMAND: string;

export declare function createSshArgs(remote: string, command: string): string[];
export declare function normalizePowerShellInput(script: string): string;
