export const SSH_CONTROL_TOOL_NAMES = Object.freeze([
	"ssh_activate",
	"ssh_status",
	"ssh_deactivate",
]);

export const SSH_REMOTE_TOOL_NAMES = Object.freeze([
	"ssh_read",
	"ssh_write",
	"ssh_edit",
	"ssh_bash",
]);

export const SSH_TOOL_NAMES = Object.freeze([
	...SSH_CONTROL_TOOL_NAMES,
	...SSH_REMOTE_TOOL_NAMES,
]);

function toolName(tool) {
	return typeof tool === "string" ? tool : tool?.name;
}

export function getSshToolState(allTools = [], activeTools = []) {
	const registeredNames = new Set(allTools.map(toolName).filter(Boolean));
	const activeNames = new Set(activeTools);
	const registered = SSH_TOOL_NAMES.filter((name) => registeredNames.has(name));
	const active = SSH_TOOL_NAMES.filter((name) => activeNames.has(name));
	const missingRegistration = SSH_TOOL_NAMES.filter((name) => !registeredNames.has(name));
	const inactive = registered.filter((name) => !activeNames.has(name));

	return { registered, active, missingRegistration, inactive };
}

export function mergeRegisteredSshTools(allTools = [], activeTools = []) {
	const registeredNames = new Set(allTools.map(toolName).filter(Boolean));
	return [...new Set([
		...activeTools,
		...SSH_TOOL_NAMES.filter((name) => registeredNames.has(name)),
	])];
}
