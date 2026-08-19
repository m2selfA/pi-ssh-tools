import { posix, relative as localRelative, resolve as localResolve, win32 } from "node:path";

const WINDOWS_PLATFORM = "windows-powershell";
const VIRTUAL_ROOT = ".pi-ssh-tools-virtual";

function isWindowsPlatform(platform) {
	return platform === WINDOWS_PLATFORM;
}

function remoteApi(platform) {
	return isWindowsPlatform(platform) ? win32 : posix;
}

function forwardSlashes(value) {
	return value.replaceAll("\\", "/");
}

function normalizeRemoteAbsolute(value, platform) {
	const api = remoteApi(platform);
	const normalized = api.normalize(value);
	return isWindowsPlatform(platform) ? forwardSlashes(normalized) : normalized;
}

function resolveRemoteAbsolute(base, value, platform) {
	const api = remoteApi(platform);
	return normalizeRemoteAbsolute(api.resolve(base, value), platform);
}

function expandRemoteHome(value, remoteHome, platform) {
	const isTildePath = value === "~" || value.startsWith("~/") || (isWindowsPlatform(platform) && value.startsWith("~\\"));
	if (isTildePath) {
		if (!remoteHome) {
			throw new Error(`SSH path mapping needs the remote home directory for path: ${value}`);
		}
		const suffix = value === "~" ? "" : value.slice(2);
		return suffix ? remoteApi(platform).join(remoteHome, suffix) : remoteHome;
	}
	if (/^~[^/\\]/.test(value)) {
		throw new Error(`SSH path mapping does not support another user's home: ${value}`);
	}
	return value;
}

function relativeRemotePath(base, value, platform) {
	const api = remoteApi(platform);
	return forwardSlashes(api.relative(base, value));
}

function isInsideRemoteCwd(relativePath, platform) {
	const api = remoteApi(platform);
	return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith("../") && !api.isAbsolute(relativePath));
}

function encodeRelativePath(relativePath) {
	return [VIRTUAL_ROOT, "relative", ...relativePath.split("/")].join("/");
}

function encodeAbsolutePath(absolutePath, platform) {
	if (!isWindowsPlatform(platform)) {
		const parts = absolutePath === "/" ? ["root"] : absolutePath.replace(/^\/+/, "").split("/");
		return [VIRTUAL_ROOT, "absolute", "posix", ...parts].join("/");
	}

	const normalized = win32.normalize(absolutePath);
	const driveMatch = normalized.match(/^([A-Za-z]):[\\/](.*)$/);
	if (driveMatch) {
		const parts = driveMatch[2] ? driveMatch[2].split(/[\\/]+/).filter(Boolean) : ["root"];
		return [VIRTUAL_ROOT, "absolute", "windows", `drive-${driveMatch[1].toUpperCase()}`, ...parts].join("/");
	}

	const uncMatch = normalized.match(/^\\\\([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/);
	if (uncMatch) {
		const parts = uncMatch[3] ? uncMatch[3].split(/[\\/]+/).filter(Boolean) : ["root"];
		return [VIRTUAL_ROOT, "absolute", "windows", "unc", uncMatch[1], uncMatch[2], ...parts].join("/");
	}

	throw new Error(`SSH path mapping could not encode remote Windows path: ${absolutePath}`);
}

function decodeVirtualPath(relativePath, remoteCwd, platform) {
	const parts = relativePath.split("/");
	if (parts[0] !== VIRTUAL_ROOT) return undefined;

	if (parts[1] === "relative") {
		const suffix = parts.slice(2).join("/");
		return resolveRemoteAbsolute(remoteCwd, suffix || ".", platform);
	}

	if (parts[1] !== "absolute") return undefined;
	if (parts[2] === "posix") {
		const suffix = parts.slice(3).join("/");
		return suffix === "root" ? "/" : `/${suffix}`;
	}

	if (parts[2] === "windows") {
		const kind = parts[3] ?? "";
		if (kind.startsWith("drive-") && kind.length === 7) {
			const suffix = parts.slice(4).join("/");
			return suffix === "root" ? `${kind.slice(6)}:/` : `${kind.slice(6)}:/${suffix}`;
		}
		if (kind === "unc" && parts.length >= 6) {
			const suffixParts = parts.slice(6);
			return `//${parts[4]}/${parts[5]}${suffixParts.length > 0 && suffixParts[0] !== "root" ? `/${suffixParts.join("/")}` : ""}`;
		}
	}

	return undefined;
}

/**
 * Map model-facing remote paths through Pi's local path resolver without
 * allowing the controller OS to reinterpret the remote path syntax.
 */
export function createRemotePathMapper(localCwd, remoteCwd, remoteHome, platform) {
	const normalizedLocalCwd = localResolve(localCwd);
	const normalizedRemoteCwd = normalizeRemoteAbsolute(remoteCwd, platform);
	const normalizedRemoteHome = remoteHome ? normalizeRemoteAbsolute(remoteHome, platform) : "";

	const toCorePath = (inputPath) => {
		if (typeof inputPath !== "string" || inputPath.length === 0) {
			throw new Error("SSH path must be a non-empty string");
		}

		const expanded = expandRemoteHome(inputPath, normalizedRemoteHome, platform);
		const remoteAbsolute = resolveRemoteAbsolute(normalizedRemoteCwd, expanded, platform);
		const relativePath = relativeRemotePath(normalizedRemoteCwd, remoteAbsolute, platform);

		if (isInsideRemoteCwd(relativePath, platform)) {
			const cleanRelativePath = relativePath || ".";
			return cleanRelativePath === VIRTUAL_ROOT || cleanRelativePath.startsWith(`${VIRTUAL_ROOT}/`)
				? encodeRelativePath(cleanRelativePath)
				: cleanRelativePath;
		}

		return encodeAbsolutePath(remoteAbsolute, platform);
	};

	const toRemotePath = (absolutePath) => {
		const resolvedLocalPath = localResolve(absolutePath);
		const localRelativePath = forwardSlashes(localRelative(normalizedLocalCwd, resolvedLocalPath));
		if (localRelativePath === ".." || localRelativePath.startsWith("../")) {
			throw new Error(`SSH path mapping escaped the local workspace: ${absolutePath}`);
		}
		if (localRelativePath === "") return normalizedRemoteCwd;

		const decoded = decodeVirtualPath(localRelativePath, normalizedRemoteCwd, platform);
		if (decoded !== undefined) return normalizeRemoteAbsolute(decoded, platform);
		return resolveRemoteAbsolute(normalizedRemoteCwd, localRelativePath, platform);
	};

	return { toCorePath, toRemotePath };
}

export { VIRTUAL_ROOT };
