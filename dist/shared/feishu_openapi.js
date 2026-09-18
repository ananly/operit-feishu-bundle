"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTimeoutMs = exports.openApiRequest = exports.callModelAPI = exports.replyMessage = exports.sendMessage = exports.fetchWsEndpoint = exports.fetchTenantAccessToken = void 0;
const feishu_common_js_1 = require("./feishu_common.js");
// 获取 tenant_access_token
async function fetchTenantAccessToken(appId, appSecret, useSandbox = false) {
    const baseUrl = useSandbox ? feishu_common_js_1.SANDBOX_FEISHU_OPEN_BASE_URL : feishu_common_js_1.FEISHU_OPEN_BASE_URL;
    const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
    const response = await (0, feishu_common_js_1.fetchCompat)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        timeout: 20000,
    });
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return { code: -1, msg: `Failed to parse response: ${text}` };
    }
}
exports.fetchTenantAccessToken = fetchTenantAccessToken;
// 获取 WebSocket 端点
async function fetchWsEndpoint(appId, appSecret, useSandbox = false) {
    const baseUrl = useSandbox ? feishu_common_js_1.SANDBOX_FEISHU_OPEN_BASE_URL : feishu_common_js_1.FEISHU_OPEN_BASE_URL;
    const url = `${baseUrl}/callback/ws/endpoint`;
    const response = await (0, feishu_common_js_1.fetchCompat)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ AppID: appId, AppSecret: appSecret }),
        timeout: 20000,
    });
    const text = await response.text();
    try {
        const raw = JSON.parse(text);
        const rawData = raw && raw.data ? raw.data : undefined;
        return {
            ...raw,
            data: rawData
                ? { ...rawData, url: rawData.url || rawData.URL || "", service_id: rawData.service_id || rawData.ServiceId || 0 }
                : rawData,
        };
    }
    catch {
        return { code: -1, msg: `Failed to parse response: ${text}` };
    }
}
exports.fetchWsEndpoint = fetchWsEndpoint;
// 发送消息（飞书 OpenAPI）
async function sendMessage(token, receiveIdType, receiveId, msgType, content, useSandbox = false) {
    const baseUrl = useSandbox ? feishu_common_js_1.SANDBOX_FEISHU_OPEN_BASE_URL : feishu_common_js_1.FEISHU_OPEN_BASE_URL;
    const url = `${baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    const body = {
        receive_id: receiveId,
        msg_type: msgType,
        content: content,
    };
    const response = await (0, feishu_common_js_1.fetchCompat)(url, {
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
        return JSON.parse(text);
    }
    catch {
        return { code: -1, msg: `Failed to parse response: ${text}` };
    }
}
exports.sendMessage = sendMessage;
// 回复消息（使用 message_id）
async function replyMessage(token, messageId, msgType, content, useSandbox = false) {
    const baseUrl = useSandbox ? feishu_common_js_1.SANDBOX_FEISHU_OPEN_BASE_URL : feishu_common_js_1.FEISHU_OPEN_BASE_URL;
    const url = `${baseUrl}/open-apis/im/v1/messages/${messageId}/reply`;
    const body = {
        msg_type: msgType,
        content: content,
    };
    const response = await (0, feishu_common_js_1.fetchCompat)(url, {
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
        return JSON.parse(text);
    }
    catch {
        return { code: -1, msg: `Failed to parse response: ${text}` };
    }
}
exports.replyMessage = replyMessage;
// 调用模型 API
async function callModelAPI(apiKey, endpoint, modelName, userMessage, systemPrompt) {
    const messages = [];
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
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const response = await (0, feishu_common_js_1.fetchCompat)(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        timeout: 60000,
    });
    const text = await response.text();
    try {
        const json = JSON.parse(text);
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
    }
    catch {
        return `[模型响应解析失败] ${text.slice(0, 200)}`;
    }
}
exports.callModelAPI = callModelAPI;
// 通用 OpenAPI 请求
async function openApiRequest(token, method, path, body, useSandbox = false) {
    const baseUrl = useSandbox ? feishu_common_js_1.SANDBOX_FEISHU_OPEN_BASE_URL : feishu_common_js_1.FEISHU_OPEN_BASE_URL;
    const url = `${baseUrl}${path}`;
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
    const options = { method, headers, timeout: 20000 };
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
        options.body = JSON.stringify(body);
    }
    try {
        const response = await (0, feishu_common_js_1.fetchCompat)(url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            timeout: options.timeout,
        });
        const text = await response.text();
        let jsonBody = {};
        try {
            jsonBody = JSON.parse(text);
        }
        catch { }
        return { ok: response.ok, status: response.status, body: jsonBody, text };
    }
    catch (error) {
        return { ok: false, status: 0, body: {}, text: (0, feishu_common_js_1.safeErrorMessage)(error) };
    }
}
exports.openApiRequest = openApiRequest;
function resolveTimeoutMs(value, fallback = 20000) {
    return (0, feishu_common_js_1.parsePositiveInt)(value, "timeout_ms", fallback);
}
exports.resolveTimeoutMs = resolveTimeoutMs;
