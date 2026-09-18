"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStatus = exports.writeServiceStateAsync = exports.getServiceLogPath = exports.deleteFileIfExistsAsync = exports.readTextFileWithTools = exports.readEnv = exports.writeEnv = exports.updatePersistedConfigAsync = exports.requireConfiguredSnapshotAsync = exports.readConfigSnapshotAsync = exports.getStateDirectoryPath = void 0;
const feishu_common_js_1 = require("./feishu_common.js");
const SERVICE_STATE_FILE_NAME = "feishu_service_state.json";
let stateDirectoryPathCache = "";
const cachedJsonStores = Object.create(null);
function cloneJsonObject(value) {
    return JSON.parse(JSON.stringify(value));
}
function normalizeStorePath(path) {
    return (0, feishu_common_js_1.asText)(path).trim().replace(/\\/g, "/");
}
function getCachedJsonStoreEntry(path) {
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
async function readJsonObjectFileAsync(path) {
    try {
        const content = await Tools.Files.read(path);
        return (0, feishu_common_js_1.parseJsonObject)(content.content);
    }
    catch {
        return {};
    }
}
async function writeJsonObjectFileAsync(path, value) {
    await Tools.Files.write(path, JSON.stringify(value, null, 2));
}
async function readCachedJsonStoreAsync(path, sanitize) {
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
async function writeCachedJsonStoreAsync(path, value, sanitize) {
    const entry = getCachedJsonStoreEntry(path);
    const nextValue = sanitize ? sanitize(value) : value;
    entry.value = cloneJsonObject(nextValue);
    entry.loaded = true;
    entry.dirty = true;
    return cloneJsonObject(nextValue);
}
async function flushCachedJsonStoreAsync(path) {
    const entry = getCachedJsonStoreEntry(path);
    if (!entry.loaded || !entry.dirty) {
        return;
    }
    await writeJsonObjectFileAsync(path, entry.value);
    entry.dirty = false;
}
function getStateDirectoryPath() {
    if (stateDirectoryPathCache) {
        return stateDirectoryPathCache;
    }
    if (!ToolPkg || typeof ToolPkg.getConfigDir !== "function") {
        throw new Error("ToolPkg.getConfigDir is unavailable");
    }
    const path = (0, feishu_common_js_1.asText)(ToolPkg.getConfigDir(feishu_common_js_1.FEISHU_TOOLPKG_ID)).trim();
    if (!path) {
        throw new Error(`Failed to resolve plugin config dir for ${feishu_common_js_1.FEISHU_TOOLPKG_ID}`);
    }
    stateDirectoryPathCache = path;
    return path;
}
exports.getStateDirectoryPath = getStateDirectoryPath;
function getConfigFilePath() {
    return `${getStateDirectoryPath()}/${feishu_common_js_1.CONFIG_FILE_NAME}`;
}
function getServiceStateFilePath() {
    return `${getStateDirectoryPath()}/${SERVICE_STATE_FILE_NAME}`;
}
function getLogFilePath() {
    return `${getStateDirectoryPath()}/${feishu_common_js_1.LOG_FILE_NAME}`;
}
function sanitizeConfig(value) {
    const result = {};
    if (typeof value.app_id === "string")
        result.app_id = value.app_id;
    if (typeof value.app_secret === "string")
        result.app_secret = value.app_secret;
    if (typeof value.model_api_key === "string")
        result.model_api_key = value.model_api_key;
    if (typeof value.model_endpoint === "string")
        result.model_endpoint = value.model_endpoint;
    if (typeof value.model_name === "string")
        result.model_name = value.model_name;
    if (typeof value.model_config_id === "string")
        result.model_config_id = value.model_config_id;
    if (typeof value.use_sandbox === "boolean")
        result.use_sandbox = value.use_sandbox;
    return result;
}
async function readConfigSnapshotAsync() {
    const path = getConfigFilePath();
    const value = await readCachedJsonStoreAsync(path, sanitizeConfig);
    return value;
}
exports.readConfigSnapshotAsync = readConfigSnapshotAsync;
async function requireConfiguredSnapshotAsync() {
    const snapshot = await readConfigSnapshotAsync();
    if (!snapshot.app_id || !snapshot.app_secret) {
        throw new Error("飞书机器人尚未配置，请先调用 feishu_bot_configure 工具");
    }
    return snapshot;
}
exports.requireConfiguredSnapshotAsync = requireConfiguredSnapshotAsync;
async function updatePersistedConfigAsync(updates) {
    const path = getConfigFilePath();
    const current = await readCachedJsonStoreAsync(path, sanitizeConfig);
    const merged = { ...current, ...updates };
    const sanitized = sanitizeConfig(merged);
    await writeCachedJsonStoreAsync(path, sanitized);
    await flushCachedJsonStoreAsync(path);
    return sanitized;
}
exports.updatePersistedConfigAsync = updatePersistedConfigAsync;
async function writeEnv(key, value) {
    // Tools.System has no setEnv; use shell export as best-effort fallback
    try {
        await Tools.System.shell(`export ${key}=${value}`);
    }
    catch {
        // best-effort only; config is persisted via updatePersistedConfigAsync
    }
}
exports.writeEnv = writeEnv;
async function readEnv(key) {
    return (0, feishu_common_js_1.asText)(getEnv(key));
}
exports.readEnv = readEnv;
async function readTextFileWithTools(path) {
    try {
        return (await Tools.Files.read(path)).content;
    }
    catch {
        return "";
    }
}
exports.readTextFileWithTools = readTextFileWithTools;
async function deleteFileIfExistsAsync(path) {
    try {
        await Tools.Files.deleteFile(path);
    }
    catch { }
}
exports.deleteFileIfExistsAsync = deleteFileIfExistsAsync;
function getServiceLogPath() {
    return getLogFilePath();
}
exports.getServiceLogPath = getServiceLogPath;
async function writeServiceStateAsync(updates) {
    const path = getServiceStateFilePath();
    const current = await readCachedJsonStoreAsync(path);
    const merged = { ...current, ...updates };
    await writeCachedJsonStoreAsync(path, merged);
    await flushCachedJsonStoreAsync(path);
    return merged;
}
exports.writeServiceStateAsync = writeServiceStateAsync;
async function probeServiceHealth() {
    try {
        const response = await (0, feishu_common_js_1.fetchCompat)(`http://127.0.0.1:${feishu_common_js_1.LOCAL_SERVICE_PORT}/health`, {
            method: "GET",
            timeout: 3000,
        });
        if (!response || !response.ok)
            return false;
        const text = (await response.text()) || "";
        return text.indexOf("ok") >= 0 || text.indexOf("OK") >= 0;
    }
    catch {
        return false;
    }
}
async function buildStatus(config) {
    const resolvedConfig = config || await readConfigSnapshotAsync();
    const serviceState = await readCachedJsonStoreAsync(getServiceStateFilePath());
    // fix: prefer live /health probe; cached state file is legacy/best-effort fallback only
    const healthy = await probeServiceHealth();
    const cachedRunning = (0, feishu_common_js_1.toBoolean)(serviceState.running, false);
    const cachedPid = serviceState.pid || null;
    let resolvedPid = cachedPid;
    if (healthy && !resolvedPid) {
        resolvedPid = await readPidFileValueAsync();
    }
    return {
        configured: !!(resolvedConfig.app_id && resolvedConfig.app_secret),
        app_id_masked: resolvedConfig.app_id ? (0, feishu_common_js_1.maskSecret)(resolvedConfig.app_id) : "",
        model_endpoint: resolvedConfig.model_endpoint || "",
        model_name: resolvedConfig.model_name || "",
        model_config_id: resolvedConfig.model_config_id || "",
        use_sandbox: (0, feishu_common_js_1.toBoolean)(resolvedConfig.use_sandbox, false),
        service_running: healthy || cachedRunning,
        service_pid: healthy ? resolvedPid : cachedPid,
        last_start_time: serviceState.lastStartTime || null,
        last_stop_time: serviceState.lastStopTime || null,
        queued_events_count: Array.isArray(serviceState.events) ? serviceState.events.length : 0,
    };
}
exports.buildStatus = buildStatus;
async function readPidFileValueAsync() {
    try {
        const raw = await readPidFileRawAsync();
        const pid = (0, feishu_common_js_1.asText)(raw).trim();
        const m = pid.match(/\d+/);
        return m ? m[0] : null;
    }
    catch {
        return null;
    }
}
async function readPidFileRawAsync() {
    const candidates = [
        `${getStateDirectoryPath()}/feishu_gateway.pid`,
        "/data/user/0/com.ai.assistance.operit/cache/Operit/cleanOnExit/feishu_gateway.pid",
    ];
    for (const p of candidates) {
        try {
            const content = await Tools.Files.read(p);
            if (content && content.content)
                return content.content;
        }
        catch { }
    }
    return "";
}
