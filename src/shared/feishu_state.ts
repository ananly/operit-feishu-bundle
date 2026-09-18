import {
  FEISHU_TOOLPKG_ID,
  CONFIG_FILE_NAME,
  LOG_FILE_NAME,
  ENV_KEYS,
  LOCAL_SERVICE_PORT,
  FeishuConfigSnapshot,
  asText,
  hasOwn,
  isObject,
  maskSecret,
  parseJsonObject,
  parseOptionalBoolean,
  toBoolean,
  fetchCompat,
} from "./feishu_common.js";

const SERVICE_STATE_FILE_NAME = "feishu_service_state.json";

type CachedJsonStoreEntry = {
  loaded: boolean;
  dirty: boolean;
  value: Record<string, unknown>;
};

let stateDirectoryPathCache = "";
const cachedJsonStores: Record<string, CachedJsonStoreEntry> = Object.create(null);

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStorePath(path: string): string {
  return asText(path).trim().replace(/\\/g, "/");
}

function getCachedJsonStoreEntry(path: string): CachedJsonStoreEntry {
  const normalizedPath = normalizeStorePath(path);
  if (!normalizedPath) {
    throw new Error("State store path is empty");
  }
  if (!cachedJsonStores[normalizedPath]) {
    cachedJsonStores[normalizedPath] = {
      loaded: false,
      dirty: false,
      value: {},
    };
  }
  return cachedJsonStores[normalizedPath];
}

async function readJsonObjectFileAsync(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await Tools.Files.read(path);
    return parseJsonObject(content.content);
  } catch {
    return {};
  }
}

async function writeJsonObjectFileAsync(path: string, value: Record<string, unknown>): Promise<void> {
  await Tools.Files.write(path, JSON.stringify(value, null, 2));
}

async function readCachedJsonStoreAsync(
  path: string,
  sanitize?: (value: Record<string, unknown>) => Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entry = getCachedJsonStoreEntry(path);
  if (!entry.loaded) {
    const raw = await readJsonObjectFileAsync(path);
    const nextValue = sanitize ? sanitize(raw) : raw;
    entry.value = cloneJsonObject(nextValue);
    entry.loaded = true;
    entry.dirty = false;
  }
  return cloneJsonObject(entry.value);
}

async function writeCachedJsonStoreAsync(
  path: string,
  value: Record<string, unknown>,
  sanitize?: (value: Record<string, unknown>) => Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entry = getCachedJsonStoreEntry(path);
  const nextValue = sanitize ? sanitize(value) : value;
  entry.value = cloneJsonObject(nextValue);
  entry.loaded = true;
  entry.dirty = true;
  return cloneJsonObject(nextValue);
}

async function flushCachedJsonStoreAsync(path: string): Promise<void> {
  const entry = getCachedJsonStoreEntry(path);
  if (!entry.loaded || !entry.dirty) {
    return;
  }
  await writeJsonObjectFileAsync(path, entry.value);
  entry.dirty = false;
}

export function getStateDirectoryPath(): string {
  if (stateDirectoryPathCache) {
    return stateDirectoryPathCache;
  }
  if (!ToolPkg || typeof ToolPkg.getConfigDir !== "function") {
    throw new Error("ToolPkg.getConfigDir is unavailable");
  }
  const path = asText(ToolPkg.getConfigDir(FEISHU_TOOLPKG_ID)).trim();
  if (!path) {
    throw new Error(`Failed to resolve plugin config dir for ${FEISHU_TOOLPKG_ID}`);
  }
  stateDirectoryPathCache = path;
  return path;
}

function getConfigFilePath(): string {
  return `${getStateDirectoryPath()}/${CONFIG_FILE_NAME}`;
}

function getServiceStateFilePath(): string {
  return `${getStateDirectoryPath()}/${SERVICE_STATE_FILE_NAME}`;
}

function getLogFilePath(): string {
  return `${getStateDirectoryPath()}/${LOG_FILE_NAME}`;
}

function sanitizeConfig(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (typeof value.app_id === "string") result.app_id = value.app_id;
  if (typeof value.app_secret === "string") result.app_secret = value.app_secret;
  if (typeof value.model_api_key === "string") result.model_api_key = value.model_api_key;
  if (typeof value.model_endpoint === "string") result.model_endpoint = value.model_endpoint;
  if (typeof value.model_name === "string") result.model_name = value.model_name;
  if (typeof value.model_config_id === "string") result.model_config_id = value.model_config_id;
  if (typeof value.use_sandbox === "boolean") result.use_sandbox = value.use_sandbox;
  return result;
}

export async function readConfigSnapshotAsync(): Promise<FeishuConfigSnapshot> {
  const path = getConfigFilePath();
  const value = await readCachedJsonStoreAsync(path, sanitizeConfig);
  return value as FeishuConfigSnapshot;
}

export async function requireConfiguredSnapshotAsync(): Promise<FeishuConfigSnapshot> {
  const snapshot = await readConfigSnapshotAsync();
  if (!snapshot.app_id || !snapshot.app_secret) {
    throw new Error("飞书机器人尚未配置，请先调用 feishu_bot_configure 工具");
  }
  return snapshot;
}

export async function updatePersistedConfigAsync(
  updates: Partial<FeishuConfigSnapshot>
): Promise<FeishuConfigSnapshot> {
  const path = getConfigFilePath();
  const current = await readCachedJsonStoreAsync(path, sanitizeConfig);
  const merged = { ...current, ...updates };
  const sanitized = sanitizeConfig(merged);
  await writeCachedJsonStoreAsync(path, sanitized);
  await flushCachedJsonStoreAsync(path);
  return sanitized as FeishuConfigSnapshot;
}

export async function writeEnv(key: string, value: string): Promise<void> {
  // Tools.System has no setEnv; use shell export as best-effort fallback
  try {
    await Tools.System.shell(`export ${key}=${value}`);
  } catch {
    // best-effort only; config is persisted via updatePersistedConfigAsync
  }
}

export async function readEnv(key: string): Promise<string> {
  return asText(getEnv(key));
}

export async function readTextFileWithTools(path: string): Promise<string> {
  try {
    return (await Tools.Files.read(path)).content;
  } catch {
    return "";
  }
}

export async function deleteFileIfExistsAsync(path: string): Promise<void> {
  try {
    await Tools.Files.deleteFile(path);
  } catch {}
}

export function getServiceLogPath(): string {
  return getLogFilePath();
}

export async function writeServiceStateAsync(
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = getServiceStateFilePath();
  const current = await readCachedJsonStoreAsync(path);
  const merged = { ...current, ...updates };
  await writeCachedJsonStoreAsync(path, merged);
  await flushCachedJsonStoreAsync(path);
  return merged;
}
async function probeServiceHealth(): Promise<boolean> {
  try {
    const response = await fetchCompat(`http://127.0.0.1:${LOCAL_SERVICE_PORT}/health`, {
      method: "GET",
      timeout: 3000,
    } as any);
    if (!response || !response.ok) return false;
    const text = (await response.text()) || "";
    return text.indexOf("ok") >= 0 || text.indexOf("OK") >= 0;
  } catch {
    return false;
  }
}
export async function buildStatus(config?: FeishuConfigSnapshot): Promise<Record<string, unknown>> {
  const resolvedConfig = config || await readConfigSnapshotAsync();
  const serviceState = await readCachedJsonStoreAsync(getServiceStateFilePath());
  // fix: prefer live /health probe; cached state file is legacy/best-effort fallback only
  const healthy = await probeServiceHealth();
  const cachedRunning = toBoolean(serviceState.running, false);
  const cachedPid = serviceState.pid || null;
  let resolvedPid = cachedPid;
  if (healthy && !resolvedPid) {
    resolvedPid = await readPidFileValueAsync();
  }
  return {
    configured: !!(resolvedConfig.app_id && resolvedConfig.app_secret),
    app_id_masked: resolvedConfig.app_id ? maskSecret(resolvedConfig.app_id) : "",
    model_endpoint: resolvedConfig.model_endpoint || "",
    model_name: resolvedConfig.model_name || "",
    model_config_id: resolvedConfig.model_config_id || "",
    use_sandbox: toBoolean(resolvedConfig.use_sandbox, false),
    service_running: healthy || cachedRunning,
    service_pid: healthy ? resolvedPid : cachedPid,
    last_start_time: serviceState.lastStartTime || null,
    last_stop_time: serviceState.lastStopTime || null,
    queued_events_count: Array.isArray(serviceState.events) ? serviceState.events.length : 0,
  };
}
async function readPidFileValueAsync(): Promise<string | null> {
  try {
    const raw = await readPidFileRawAsync();
    const pid = asText(raw).trim();
    const m = pid.match(/\d+/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}
async function readPidFileRawAsync(): Promise<string> {
  const candidates = [
    `${getStateDirectoryPath()}/feishu_gateway.pid`,
    "/data/user/0/com.ai.assistance.operit/cache/Operit/cleanOnExit/feishu_gateway.pid",
  ];
  for (const p of candidates) {
    try {
      const content = await Tools.Files.read(p);
      if (content && content.content) return content.content;
    } catch {}
  }
  return "";
}