"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestJson = exports.fetchCompat = exports.createControlToken = exports.shellQuote = exports.parseJsonObject = exports.maskSecret = exports.parsePositiveInt = exports.toBoolean = exports.parseOptionalBoolean = exports.safeErrorMessage = exports.firstNonBlank = exports.isObject = exports.hasOwn = exports.asText = exports.FeishuReceiveIdType = exports.FeishuMessageType = exports.FeishuEventType = exports.MessageType = exports.TERMINAL_SERVICE_OUTPUT_FILE_NAME = exports.TERMINAL_SERVICE_RESOURCE_KEY = exports.MAX_RECEIVE_LIMIT = exports.DEFAULT_RECEIVE_LIMIT = exports.DEFAULT_SERVICE_WAIT_MS = exports.LOCAL_SERVICE_PORT = exports.DEFAULT_WS_CONFIG = exports.ENV_KEYS = exports.DEFAULT_MODEL_CONFIG = exports.SANDBOX_FEISHU_OPEN_BASE_URL = exports.FEISHU_OPEN_BASE_URL = exports.LOG_FILE_NAME = exports.CONFIG_FILE_NAME = exports.FEISHU_TOOLPKG_ID = exports.PACKAGE_VERSION = void 0;
exports.PACKAGE_VERSION = "0.1.0";
exports.FEISHU_TOOLPKG_ID = "com.operit.feishu_bundle";
exports.CONFIG_FILE_NAME = "feishu_config.json";
exports.LOG_FILE_NAME = "feishu_service.log";
// 飞书 API 端点
exports.FEISHU_OPEN_BASE_URL = "https://open.feishu.cn";
exports.SANDBOX_FEISHU_OPEN_BASE_URL = "https://open.feishu.cn"; // 沙箱模式
// 默认模型配置（与 Operit 原生配置对齐）
exports.DEFAULT_MODEL_CONFIG = {
    DEEPSEEK: {
        endpoint: "https://api.deepseek.com/v1/chat/completions",
        model: "deepseek-v4-flash",
    },
    LONGCAT: {
        endpoint: "https://api.longcat.chat/openai/v1/chat/completions",
        model: "LongCat-2.0",
    },
};
// 环境变量键名
exports.ENV_KEYS = {
    APP_ID: "FEISHU_APP_ID",
    APP_SECRET: "FEISHU_APP_SECRET",
    MODEL_API_KEY: "FEISHU_MODEL_API_KEY",
    MODEL_ENDPOINT: "FEISHU_MODEL_ENDPOINT",
    MODEL_NAME: "FEISHU_MODEL_NAME",
    MODEL_CONFIG_ID: "FEISHU_MODEL_CONFIG_ID",
    USE_SANDBOX: "FEISHU_USE_SANDBOX",
};
// WebSocket 配置
exports.DEFAULT_WS_CONFIG = {
    pingInterval: 90000, // 心跳间隔（毫秒）
    reconnectCount: -1, // 重连次数（-1 无限）
    reconnectInterval: 90000, // 重连间隔（毫秒）
    reconnectNonce: 25000, // 重连抖动（毫秒）
};
// 服务端口
exports.LOCAL_SERVICE_PORT = 18790;
// 服务等待超时（毫秒）
exports.DEFAULT_SERVICE_WAIT_MS = 8000;
// 事件队列默认/最大接收数量
exports.DEFAULT_RECEIVE_LIMIT = 20;
exports.MAX_RECEIVE_LIMIT = 100;
// 资源键名
exports.TERMINAL_SERVICE_RESOURCE_KEY = "feishu_gateway_service_py";
exports.TERMINAL_SERVICE_OUTPUT_FILE_NAME = "feishu_gateway_service.py";
// 消息类型
exports.MessageType = {
    EVENT: "event",
    CARD: "card",
    PING: "ping",
    PONG: "pong",
};
// 飞书事件类型
exports.FeishuEventType = {
    IM_MESSAGE_RECEIVE_V1: "im.message.receive_v1",
    IM_MESSAGE_MESSAGE_RECEIVED: "im.message.message_received_v1",
};
// 消息类型（飞书）
exports.FeishuMessageType = {
    TEXT: "text",
    IMAGE: "image",
    FILE: "file",
    AUDIO: "audio",
    MEDIA: "media",
    STICKER: "sticker",
    INTERACTIVE: "interactive",
    SHARE_CHAT: "share_chat",
    SHARE_USER: "share_user",
    SYSTEM: "system",
};
// 接收者类型
exports.FeishuReceiveIdType = {
    OPEN_ID: "open_id",
    USER_ID: "user_id",
    UNION_ID: "union_id",
    EMAIL: "email",
    CHAT_ID: "chat_id",
};
// 工具函数
function asText(value, fallback = "") {
    if (value == null)
        return fallback;
    if (typeof value === "string")
        return value;
    return String(value);
}
exports.asText = asText;
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
exports.hasOwn = hasOwn;
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
exports.isObject = isObject;
function firstNonBlank(...values) {
    for (const v of values) {
        if (v && v.trim())
            return v;
    }
    return "";
}
exports.firstNonBlank = firstNonBlank;
function safeErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "string")
        return error;
    return String(error);
}
exports.safeErrorMessage = safeErrorMessage;
function parseOptionalBoolean(value, fieldName) {
    if (value === undefined || value === null || value === "")
        return undefined;
    const s = asText(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on")
        return true;
    if (s === "false" || s === "0" || s === "no" || s === "off")
        return false;
    throw new Error(`${fieldName} must be a boolean, got: ${s}`);
}
exports.parseOptionalBoolean = parseOptionalBoolean;
function toBoolean(value, fallback = false) {
    if (value === undefined || value === null)
        return fallback;
    return !!value;
}
exports.toBoolean = toBoolean;
function parsePositiveInt(value, fieldName, fallback) {
    const s = asText(value).trim();
    if (!s)
        return fallback;
    const n = parseInt(s, 10);
    if (isNaN(n) || n <= 0)
        throw new Error(`${fieldName} must be a positive integer, got: ${s}`);
    return n;
}
exports.parsePositiveInt = parsePositiveInt;
function maskSecret(secret) {
    if (!secret)
        return "";
    if (secret.length <= 8)
        return "****";
    return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
exports.maskSecret = maskSecret;
function parseJsonObject(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return isObject(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
exports.parseJsonObject = parseJsonObject;
function shellQuote(s) {
    return `'${s.replace(/'/g, "'\\''")}'`;
}
exports.shellQuote = shellQuote;
function createControlToken() {
    return `ctrl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
exports.createControlToken = createControlToken;
/** 把 Tools.Net 的 HttpResponseData 归一成类 fetch Response。 */
function toCompatResponse(raw) {
    const data = (raw ?? {});
    const status = typeof data.statusCode === "number" ? data.statusCode : 0;
    const text = typeof data.content === "string" ? data.content : "";
    const headers = {};
    if (isObject(data.headers)) {
        for (const key of Object.keys(data.headers)) {
            headers[key] = asText(data.headers[key]);
        }
    }
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: asText(data.statusMessage),
        headers,
        text: async () => text,
        json: async () => JSON.parse(text),
    };
}
/**
 * 兼容层：把原来 `await fetch(url, options)` 的用法，
 * 重定向到沙箱真实存在的 Tools.Net.http。
 *
 * 返回的 CompatResponse 语义与原生 fetch 对齐（ok / status / text() / json()）。
 * 网络层异常会被捕获，统一返回 ok=false, status=0，
 * 并把错误信息放进 text() 里（便于上层诊断）。
 */
async function fetchCompat(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const timeoutMs = options.timeout;
    try {
        const raw = await Tools.Net.http({
            url,
            method,
            headers: options.headers || {},
            body: options.body,
            connect_timeout: timeoutMs,
            read_timeout: timeoutMs,
            ignore_ssl: true,
        });
        return toCompatResponse(raw);
    }
    catch (error) {
        const message = safeErrorMessage(error);
        return {
            ok: false,
            status: 0,
            statusText: message,
            headers: {},
            text: async () => message,
            json: async () => {
                throw new Error(message);
            },
        };
    }
}
exports.fetchCompat = fetchCompat;
async function requestJson(method, url, body, headers, timeoutMs = 20000) {
    try {
        const options = {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            timeout: timeoutMs,
        };
        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
            options.body = JSON.stringify(body);
        }
        const response = await fetchCompat(url, options);
        const text = await response.text();
        const jsonBody = parseJsonObject(text);
        return {
            ok: response.ok,
            status: response.status,
            body: jsonBody,
            text,
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 0,
            body: {},
            text: safeErrorMessage(error),
        };
    }
}
exports.requestJson = requestJson;
