// Tiny structured console wrapper. Centralising routing gives us one place
// to swap in a forwarder later (e.g. pipe errors to Sentry or a Tauri
// command for disk-backed logs) without touching every call site. Every log
// line is prefixed with `[zenith:<scope>]` so the webview console stays
// grep-able during dev and noisy lines are easy to spot.

type Level = "error" | "warn" | "info" | "debug";

function emit(level: Level, scope: string, msg: string, data?: unknown) {
  const prefix = `[zenith:${scope}]`;
  if (level === "error") console.error(prefix, msg, data ?? "");
  else if (level === "warn") console.warn(prefix, msg, data ?? "");
  else if (level === "debug") console.debug(prefix, msg, data ?? "");
  else console.info(prefix, msg, data ?? "");
}

export const log = {
  error: (scope: string, msg: string, data?: unknown) => emit("error", scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => emit("warn", scope, msg, data),
  info: (scope: string, msg: string, data?: unknown) => emit("info", scope, msg, data),
  debug: (scope: string, msg: string, data?: unknown) => emit("debug", scope, msg, data),
};
