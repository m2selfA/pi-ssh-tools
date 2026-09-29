import { isIP } from "node:net";
import { hostname as systemHostname } from "node:os";

function normalizeHostname(value) {
	let normalized = String(value ?? "").trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		normalized = normalized.slice(1, -1);
	}
	const zoneIndex = normalized.indexOf("%");
	if (zoneIndex > 0) normalized = normalized.slice(0, zoneIndex);
	if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
	return normalized;
}

/** Extract the host portion from an SSH `user@host` target. */
export function extractSshHostname(remote) {
	let value = String(remote ?? "").trim();
	const atIndex = value.lastIndexOf("@");
	if (atIndex >= 0) value = value.slice(atIndex + 1);
	if (value.startsWith("[")) {
		const closingBracket = value.indexOf("]");
		if (closingBracket > 0) return normalizeHostname(value.slice(1, closingBracket));
	}
	if (value === "::1" || value.startsWith("::1:")) return "::1";
	const separatorIndex = value.indexOf(":");
	if (separatorIndex > 0 && !value.slice(0, separatorIndex).includes(":")) {
		value = value.slice(0, separatorIndex);
	}
	return normalizeHostname(value);
}

/** Return true for RFC loopback names, IPv4 127/8, and IPv6 loopback forms. */
export function isLoopbackHostname(value) {
	const hostname = normalizeHostname(value);
	if (!hostname) return false;
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (hostname === "ip6-localhost" || hostname === "ip6-loopback") return true;

	const ipVersion = isIP(hostname);
	if (ipVersion === 4) {
		return Number(hostname.split(".")[0]) === 127;
	}
	if (ipVersion === 6) {
		return (
			hostname === "::1" ||
			hostname === "0:0:0:0:0:0:0:1" ||
			/^::ffff:127(?:\.\d{1,3}){3}$/.test(hostname)
		);
	}
	return false;
}

/** Return normalized local hostnames that should not be SSH targets by default. */
export function getLocalHostnames() {
	const candidates = [
		(() => {
			try {
				return systemHostname();
			} catch {
				return "";
			}
		})(),
		process.env.COMPUTERNAME,
		process.env.HOSTNAME,
	];
	const names = new Set();
	for (const candidate of candidates) {
		const normalized = normalizeHostname(candidate);
		if (!normalized) continue;
		names.add(normalized);
		const shortName = normalized.split(".")[0];
		if (shortName) names.add(shortName);
	}
	return [...names];
}

/**
 * Classify a target that points back to the controller machine.
 * `resolvedHost` lets SSH config aliases be checked against their HostName value.
 */
export function classifySshTarget(remote, options = {}) {
	const candidates = [extractSshHostname(remote), extractSshHostname(options.resolvedHost)]
		.filter(Boolean)
		.filter((value, index, all) => all.indexOf(value) === index);
	for (const hostname of candidates) {
		if (isLoopbackHostname(hostname)) {
			return { kind: "loopback", hostname };
		}
	}

	const localHostnames = new Set((options.localHostnames ?? getLocalHostnames()).map(normalizeHostname).filter(Boolean));
	for (const hostname of candidates) {
		if (localHostnames.has(hostname)) {
			return { kind: "local-hostname", hostname };
		}
	}
	return null;
}

export function formatLocalTargetRefusal(remote, match) {
	const reason = match?.kind === "loopback"
		? "a loopback/local address"
		: `the controller's local hostname (${match?.hostname ?? "local host"})`;
	return [
		`Refusing SSH activation for \"${remote}\": it resolves to ${reason}.`,
		"Use the native local read/write/edit/bash tools (and powershell where available) for work on this machine.",
		"For an intentional SSH loopback/self-host test only, retry with allowLocalTarget=true.",
	].join(" ");
}

/** Throw unless the caller explicitly opts into an intentional local SSH test. */
export function assertSshTargetAllowed(remote, options = {}) {
	const match = classifySshTarget(remote, options);
	if (match && options.allowLocalTarget !== true) {
		throw new Error(formatLocalTargetRefusal(remote, match));
	}
	return match;
}
