// Containers that run code nobody has looked at, or that need nothing more: no network, nothing writable, no privileges.
export const SANDBOX = [
  "--network", "none",
  "--read-only",
  "--user", "65534:65534",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  "--memory", "256m",
  "--pids-limit", "128",
];
