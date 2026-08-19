export type RemotePathMapper = {
	toCorePath: (inputPath: string) => string;
	toRemotePath: (absolutePath: string) => string;
};

export declare function createRemotePathMapper(
	localCwd: string,
	remoteCwd: string,
	remoteHome: string,
	platform: "posix" | "windows-powershell",
): RemotePathMapper;

export declare const VIRTUAL_ROOT: string;
