import {
  FEISHU_OPEN_BASE_URL,
  SANDBOX_FEISHU_OPEN_BASE_URL,
  FeishuConfigSnapshot,
  fetchCompat,
  asText,
  hasOwn,
  isObject,
  parseOptionalBoolean,
  parsePositiveInt,
  safeErrorMessage,
  shellQuote,
  toBoolean,
} from "./feishu_common.js";

export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

export interface FeishuWsEndpointResponse {
  code: number;
  msg: string;
  data?: {
    url?: string;
    service_id?: number;
    [key: string]: unknown;
  };
}

export interface FeishuSendMsgResponse {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
    [key: string]: unknown;
  };
}

export interface FeishuModelResponse {
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

// 获取 tenant_access_token
export async function fetchTenantAccessToken(
  appId: string,
  appSecret: string,
  useSandbox = false
): Promise<FeishuTokenResponse> {
  const baseUrl = useSandbox ? SANDBOX_FEISHU_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL;
  const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
  const response = await fetchCompat(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    timeout: 20000,
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as FeishuTokenResponse;
  } catch {
    return { code: -1, msg: `Failed to parse response: ${text}` };
  }
}

// 获取 WebSocket 端点
export async function fetchWsEndpoint(
  appId: string,
  appSecret: string,
  useSandbox = false
): Promise<FeishuWsEndpointResponse> {
  const baseUrl = useSandbox ? SANDBOX_FEISHU_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL;
  const url = `${baseUrl}/callback/ws/endpoint`;
  const response = await fetchCompat(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ AppID: appId, AppSecret: appSecret }),
    timeout: 20000,
  });
  const text = await response.text();
  try {
    const raw = JSON.parse(text) as any;
    const rawData = raw && raw.data ? raw.data : undefined;
    return {
      ...raw,
      data: rawData
        ? { ...rawData, url: rawData.url || rawData.URL || "", service_id: rawData.service_id || rawData.ServiceId || 0 }
        : rawData,
    } as FeishuWsEndpointResponse;
  } catch {
    return { code: -1, msg: `Failed to parse response: ${text}` };
  }
}

// 发送消息（飞书 OpenAPI）
export async function sendMessage(
  token: string,
  receiveIdType: string,
  receiveId: string,
  msgType: string,
  content: string,
  useSandbox = false
): Promise<FeishuSendMsgResponse> {
  const baseUrl = useSandbox ? SANDBOX_FEISHU_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL;
  const url = `${baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
  const body = {
    receive_id: receiveId,
    msg_type: msgType,
    content: content,
  };
  const response = await fetchCompat(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    timeout: 20000,
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as FeishuSendMsgResponse;
  } catch {
    return { code: -1, msg: `Failed to parse response: ${text}` };
  }
}

// 回复消息（使用 message_id）
export async function replyMessage(
  token: string,
  messageId: string,
  msgType: string,
  content: string,
  useSandbox = false
): Promise<FeishuSendMsgResponse> {
  const baseUrl = useSandbox ? SANDBOX_FEISHU_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL;
  const url = `${baseUrl}/open-apis/im/v1/messages/${messageId}/reply`;
  const body = {
    msg_type: msgType,
    content: content,
  };
  const response = await fetchCompat(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    timeout: 20000,
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as FeishuSendMsgResponse;
  } catch {
    return { code: -1, msg: `Failed to parse response: ${text}` };
  }
}

// 调用模型 API
export async function callModelAPI(
  apiKey: string,
  endpoint: string,
  modelName: string,
  userMessage: string,
  systemPrompt?: string
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userMessage });

  const body = {
    model: modelName,
    messages,
    stream: false,
    temperature: 0.7,
    max_tokens: 2048,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetchCompat(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeout: 60000,
  });
  const text = await response.text();
  try {
    const json = JSON.parse(text) as FeishuModelResponse;
    if (json.error) {
      return `[模型错误] ${json.error.message || json.error.type || "未知错误"}`;
    }
    if (json.choices && json.choices.length > 0) {
      const choice = json.choices[0];
      if (choice.message && choice.message.content) {
        return choice.message.content;
      }
      if (choice.delta && choice.delta.content) {
        return choice.delta.content;
      }
    }
    return "[模型返回空内容]";
  } catch {
    return `[模型响应解析失败] ${text.slice(0, 200)}`;
  }
}

// 通用 OpenAPI 请求
export async function openApiRequest(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  useSandbox = false
): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; text: string }> {
  const baseUrl = useSandbox ? SANDBOX_FEISHU_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const options: Record<string, unknown> = { method, headers, timeout: 20000 };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetchCompat(url, {
      method: options.method as string,
      headers: options.headers as Record<string, string>,
      body: options.body as string | undefined,
      timeout: options.timeout as number | undefined,
    });
    const text = await response.text();
    let jsonBody: Record<string, unknown> = {};
    try {
      jsonBody = JSON.parse(text);
    } catch {}
    return { ok: response.ok, status: response.status, body: jsonBody, text };
  } catch (error) {
    return { ok: false, status: 0, body: {}, text: safeErrorMessage(error) };
  }
}

export function resolveTimeoutMs(value: unknown, fallback = 20000): number {
  return parsePositiveInt(value, "timeout_ms", fallback);
}