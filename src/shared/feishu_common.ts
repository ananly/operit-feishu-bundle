export const PACKAGE_VERSION = "0.1.0";
export const FEISHU_TOOLPKG_ID = "com.operit.feishu_bundle";
export const CONFIG_FILE_NAME = "feishu_config.json";
export const LOG_FILE_NAME = "feishu_service.log";

// 飞书 API 端点
export const FEISHU_OPEN_BASE_URL = "https://open.feishu.cn";
export const SANDBOX_FEISHU_OPEN_BASE_URL = "https://open.feishu.cn"; // 沙箱模式

// 默认模型配置（与 Operit 原生配置对齐）
export const DEFAULT_MODEL_CONFIG = {
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
export const ENV_KEYS = {
  APP_ID: "FEISHU_APP_ID",
  APP_SECRET: "FEISHU_APP_SECRET",
  MODEL_API_KEY: "FEISHU_MODEL_API_KEY",
  MODEL_ENDPOINT: "FEISHU_MODEL_ENDPOINT",
  MODEL_NAME: "FEISHU_MODEL_NAME",
  MODEL_CONFIG_ID: "FEISHU_MODEL_CONFIG_ID",
  USE_SANDBOX: "FEISHU_USE_SANDBOX",
};

// WebSocket 配置
export const DEFAULT_WS_CONFIG = {
  pingInterval: 90000,      // 心跳间隔（毫秒）
  reconnectCount: -1,       // 重连次数（-1 无限）
  reconnectInterval: 90000, // 重连间隔（毫秒）
  reconnectNonce: 25000,    // 重连抖动（毫秒）
};

// 服务端口
export const LOCAL_SERVICE_PORT = 18790;

// 服务等待超时（毫秒）
export const DEFAULT_SERVICE_WAIT_MS = 8000;

// 事件队列默认/最大接收数量
export const DEFAULT_RECEIVE_LIMIT = 20;
export const MAX_RECEIVE_LIMIT = 100;

// 资源键名
export const TERMINAL_SERVICE_RESOURCE_KEY = "feishu_gateway_service_py";
export const TERMINAL_SERVICE_OUTPUT_FILE_NAME = "feishu_gateway_service.py";

// 消息类型
export const MessageType = {
  EVENT: "event",
  CARD: "card",
  PING: "ping",
  PONG: "pong",
};

// 飞书事件类型
export const FeishuEventType = {
  IM_MESSAGE_RECEIVE_V1: "im.message.receive_v1",
  IM_MESSAGE_MESSAGE_RECEIVED: "im.message.message_received_v1",
};

// 消息类型（飞书）
export const FeishuMessageType = {
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
export const FeishuReceiveIdType = {
  OPEN_ID: "open_id",
  USER_ID: "user_id",
  UNION_ID: "union_id",
  EMAIL: "email",
  CHAT_ID: "chat_id",
};

// JSON 对象类型
export type JsonObject = Record<string, unknown>;

// 飞书配置快照
export interface FeishuConfigSnapshot {
  app_id?: string;
  app_secret?: string;
  model_api_key?: string;
  model_endpoint?: string;
  model_name?: string;
  /** 从 Operit 导入的模型配置 id（方案 A：记录来源，便于 UI 回显与重新导入） */
  model_config_id?: string;
  use_sandbox?: boolean;
}

// 工具结果类型 — 添加 index signature 以兼容 JsonValue 和运行时返回的额外字段
export interface FeishuActionResult {
  success: boolean;
  message?: string;
  data?: JsonObject;
  error?: string;
  configured?: boolean;
  started?: boolean;
  [key: string]: unknown;
}

// 工具函数
export function asText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  return String(value);
}

export function hasOwn(obj: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstNonBlank(...values: string[]): string {
  for (const v of values) {
    if (v && v.trim()) return v;
  }
  return "";
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

export function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = asText(value).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  throw new Error(`${fieldName} must be a boolean, got: ${s}`);
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return !!value;
}

export function parsePositiveInt(value: unknown, fieldName: string, fallback: number): number {
  const s = asText(value).trim();
  if (!s) return fallback;
  const n = parseInt(s, 10);
  if (isNaN(n) || n <= 0) throw new Error(`${fieldName} must be a positive integer, got: ${s}`);
  return n;
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

export function parseJsonObject(value: string | null): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function createControlToken(): string {
  return `ctrl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// 网络适配层（关键修复）
// ---------------------------------------------------------------------------
//
// 沙箱运行时【不存在】全局 `fetch` / `XMLHttpRequest`。
// 直接调用 `fetch(...)` 会抛 `ReferenceError: 'fetch' is not defined`，
// 在 UI 渲染链路里被包装层转译成 "Script error: not a function"。
//
// 唯一可用的网络能力是 `Tools.Net`：
//   - Tools.Net.http({ url, method, headers, body, timeout, ignoreSsl })
//   - Tools.Net.httpGet(url, ignoreSsl)
//   - Tools.Net.httpPost(url, body, ignoreSsl)
//   - 均返回 Promise<HttpResponseData>
//
// HttpResponseData 字段：
//   { __type, url, statusCode, statusMessage, headers, contentType,
//     content, contentBase64, size }
//
// 边界行为（实测）：
//   - 非 2xx（如 404）不抛异常，正常返回 statusCode；
//   - 网络层错误（如连接被关闭）会抛异常，必须 try/catch。

/** 类 fetch Response 的最小兼容对象。 */
export interface CompatResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** 把 Tools.Net 的 HttpResponseData 归一成类 fetch Response。 */
function toCompatResponse(raw: unknown): CompatResponse {
  const data = (raw ?? {}) as Record<string, unknown>;
  const status = typeof data.statusCode === "number" ? data.statusCode : 0;
  const text = typeof data.content === "string" ? data.content : "";
  const headers: Record<string, string> = {};
  if (isObject(data.headers)) {
    for (const key of Object.keys(data.headers)) {
      headers[key] = asText((data.headers as JsonObject)[key]);
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
export async function fetchCompat(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  } = {}
): Promise<CompatResponse> {
  const method = (options.method || "GET").toUpperCase() as
    | "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
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
  } catch (error) {
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

export interface RequestJsonResult {
  ok: boolean;
  status: number;
  body: JsonObject;
  text: string;
}

export async function requestJson(
  method: string,
  url: string,
  body?: JsonObject,
  headers?: Record<string, string>,
  timeoutMs = 20000
): Promise<RequestJsonResult> {
  try {
    const options: {
      method: string;
      headers: Record<string, string>;
      timeout: number;
      body?: string;
    } = {
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
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {},
      text: safeErrorMessage(error),
    };
  }
}