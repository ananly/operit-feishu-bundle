"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishu_bot_send_text_message = exports.feishu_bot_test_connection = exports.feishu_bot_clear_events = exports.feishu_bot_receive_events = exports.feishu_bot_service_stop = exports.feishu_bot_service_start = exports.feishu_bot_status = exports.feishu_bot_configure = exports.ensureFeishuServiceStarted = exports.onFeishuListenerApplicationForeground = exports.onFeishuListenerApplicationCreate = void 0;
const feishu_common_js_1 = require("./feishu_common.js");
const feishu_state_js_1 = require("./feishu_state.js");
const feishu_openapi_js_1 = require("./feishu_openapi.js");
const feishu_service_js_1 = require("./feishu_service.js");
Object.defineProperty(exports, "ensureFeishuServiceStarted", { enumerable: true, get: function () { return feishu_service_js_1.ensureFeishuServiceStarted; } });
function logFeishuRuntime(message) {
    console.log(`[feishu_runtime] ${message}`);
}
function previewJson(value, maxLength = 1200) {
    try {
        const text = JSON.stringify(value);
        if (typeof text !== "string")
            return "";
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }
    catch {
        return "[unserializable]";
    }
}
// ==================== 工具函数实现 ====================
async function feishu_bot_configure(params = {}) {
    try {
        const before = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
        const updatedConfigFields = [];
        // 更新配置字段
        if ((0, feishu_common_js_1.hasOwn)(params, "app_id")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ app_id: (0, feishu_common_js_1.asText)(params.app_id).trim() });
            updatedConfigFields.push("app_id");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "app_secret")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ app_secret: (0, feishu_common_js_1.asText)(params.app_secret).trim() });
            updatedConfigFields.push("app_secret");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "model_api_key")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ model_api_key: (0, feishu_common_js_1.asText)(params.model_api_key).trim() });
            updatedConfigFields.push("model_api_key");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "model_endpoint")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ model_endpoint: (0, feishu_common_js_1.asText)(params.model_endpoint).trim() });
            updatedConfigFields.push("model_endpoint");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "model_name")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ model_name: (0, feishu_common_js_1.asText)(params.model_name).trim() });
            updatedConfigFields.push("model_name");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "model_config_id")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({ model_config_id: (0, feishu_common_js_1.asText)(params.model_config_id).trim() });
            updatedConfigFields.push("model_config_id");
        }
        if ((0, feishu_common_js_1.hasOwn)(params, "use_sandbox")) {
            await (0, feishu_state_js_1.updatePersistedConfigAsync)({
                use_sandbox: (0, feishu_common_js_1.parseOptionalBoolean)(params.use_sandbox, "use_sandbox") === true,
            });
            updatedConfigFields.push("use_sandbox");
        }
        const after = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
        // fix: buildStatus is async, must await
        const status = await (0, feishu_state_js_1.buildStatus)(after);
        const shouldTest = (0, feishu_common_js_1.parseOptionalBoolean)(params.test_connection, "test_connection") === true;
        const shouldRestart = (0, feishu_common_js_1.parseOptionalBoolean)(params.restart_service, "restart_service") === true;
        const credentialsChanged = (0, feishu_common_js_1.hasOwn)(params, "app_id") || (0, feishu_common_js_1.hasOwn)(params, "app_secret");
        const useSandboxChanged = before.use_sandbox !== after.use_sandbox;
        const credentialsReady = !!(after.app_id && after.app_secret);
        let serviceResult = null;
        if (!credentialsReady) {
            serviceResult = await (0, feishu_service_js_1.stopFeishuServiceInternal)();
        }
        else {
            serviceResult = await (0, feishu_service_js_1.ensureFeishuServiceStarted)(after, {
                restart: shouldRestart || credentialsChanged || useSandboxChanged,
                timeoutMs: feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS,
            });
        }
        const result = {
            success: true,
            updatedConfigFields,
            status,
            service: serviceResult,
        };
        if (shouldTest) {
            const connResult = await feishu_bot_test_connection();
            result.connection = connResult;
            result.success = !!connResult.success;
        }
        return result;
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_configure = feishu_bot_configure;
async function feishu_bot_status(params = {}) {
    try {
        const snapshot = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
        const summaryOnly = (0, feishu_common_js_1.parseOptionalBoolean)(params.summary_only, "summary_only") === true;
        // fix: buildStatus is async, must await
        const status = await (0, feishu_state_js_1.buildStatus)(snapshot);
        return {
            success: true,
            ...status,
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_status = feishu_bot_status;
async function feishu_bot_service_start(params = {}) {
    try {
        const snapshot = await (0, feishu_state_js_1.requireConfiguredSnapshotAsync)();
        const result = await (0, feishu_service_js_1.ensureFeishuServiceStarted)(snapshot, {
            restart: (0, feishu_common_js_1.parseOptionalBoolean)(params.restart, "restart") === true,
            timeoutMs: (0, feishu_common_js_1.parsePositiveInt)(params.timeout_ms, "timeout_ms", feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS),
        });
        return {
            success: true,
            ...result,
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_service_start = feishu_bot_service_start;
async function feishu_bot_service_stop(params = {}) {
    try {
        const timeoutMs = (0, feishu_common_js_1.parsePositiveInt)(params.timeout_ms, "timeout_ms", feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS);
        const result = await (0, feishu_service_js_1.stopFeishuServiceInternal)();
        return {
            success: result.success,
            stoppedPids: result.stoppedPids,
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_service_stop = feishu_bot_service_stop;
async function feishu_bot_receive_events(params = {}) {
    try {
        const autoStart = (0, feishu_common_js_1.parseOptionalBoolean)(params.auto_start, "auto_start") !== false;
        if (autoStart) {
            const snapshot = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
            if (snapshot.app_id && snapshot.app_secret) {
                await (0, feishu_service_js_1.ensureFeishuServiceStarted)(snapshot, {
                    timeoutMs: feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS,
                });
            }
        }
        const result = await (0, feishu_service_js_1.queryQueuedEventsFromService)({
            limit: Math.min(feishu_common_js_1.MAX_RECEIVE_LIMIT, (0, feishu_common_js_1.parsePositiveInt)(params.limit, "limit", feishu_common_js_1.DEFAULT_RECEIVE_LIMIT)),
            consume: (0, feishu_common_js_1.parseOptionalBoolean)(params.consume, "consume") !== false,
            include_raw: (0, feishu_common_js_1.parseOptionalBoolean)(params.include_raw, "include_raw") === true,
        });
        return {
            success: true,
            ...result,
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_receive_events = feishu_bot_receive_events;
async function feishu_bot_clear_events(params = {}) {
    try {
        const result = await (0, feishu_service_js_1.clearQueuedEventsFromService)();
        return {
            success: true,
            ...result,
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_clear_events = feishu_bot_clear_events;
async function feishu_bot_test_connection(params = {}) {
    try {
        const timeoutMs = (0, feishu_openapi_js_1.resolveTimeoutMs)(params.timeout_ms);
        const snapshot = await (0, feishu_state_js_1.requireConfiguredSnapshotAsync)();
        const token = await (0, feishu_openapi_js_1.fetchTenantAccessToken)(snapshot.app_id || "", snapshot.app_secret || "", (0, feishu_common_js_1.toBoolean)(snapshot.use_sandbox, false));
        const wsEndpoint = await (0, feishu_openapi_js_1.fetchWsEndpoint)(snapshot.app_id || "", snapshot.app_secret || "", (0, feishu_common_js_1.toBoolean)(snapshot.use_sandbox, false));
        // fix: buildStatus is async, must await
        const status = await (0, feishu_state_js_1.buildStatus)(snapshot);
        const connSuccess = token.code === 0 && !!token.tenant_access_token;
        return {
            success: connSuccess,
            accessTokenType: token.tenant_access_token ? "tenant_access_token" : "",
            accessTokenExpiresIn: token.expire || 0,
            wsEndpoint: wsEndpoint.data?.url || "",
            wsEndpointServiceId: wsEndpoint.data?.service_id || 0,
            status,
            error: token.code !== 0 ? token.msg : (wsEndpoint.code !== 0 ? wsEndpoint.msg : ""),
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_test_connection = feishu_bot_test_connection;
async function feishu_bot_send_text_message(params = {}) {
    try {
        const receiveId = (0, feishu_common_js_1.asText)(params.receive_id).trim();
        if (!receiveId) {
            throw new Error("Missing param: receive_id");
        }
        const content = (0, feishu_common_js_1.asText)(params.content).trim();
        if (!content) {
            throw new Error("Missing param: content");
        }
        const receiveIdType = (0, feishu_common_js_1.asText)(params.receive_id_type, "open_id").trim() || "open_id";
        const msgId = (0, feishu_common_js_1.asText)(params.msg_id).trim();
        const timeoutMs = (0, feishu_openapi_js_1.resolveTimeoutMs)(params.timeout_ms);
        const snapshot = await (0, feishu_state_js_1.requireConfiguredSnapshotAsync)();
        const token = await (0, feishu_openapi_js_1.fetchTenantAccessToken)(snapshot.app_id || "", snapshot.app_secret || "", (0, feishu_common_js_1.toBoolean)(snapshot.use_sandbox, false));
        if (token.code !== 0 || !token.tenant_access_token) {
            throw new Error(`Failed to get tenant_access_token: ${token.msg}`);
        }
        let response;
        if (msgId) {
            response = await (0, feishu_openapi_js_1.replyMessage)(token.tenant_access_token, msgId, "text", JSON.stringify({ text: content }), (0, feishu_common_js_1.toBoolean)(snapshot.use_sandbox, false));
        }
        else {
            response = await (0, feishu_openapi_js_1.sendMessage)(token.tenant_access_token, receiveIdType, receiveId, "text", JSON.stringify({ text: content }), (0, feishu_common_js_1.toBoolean)(snapshot.use_sandbox, false));
        }
        return {
            success: response.code === 0,
            messageId: response.data?.message_id || "",
            response: response.data,
            error: response.code !== 0 ? response.msg : "",
        };
    }
    catch (error) {
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.feishu_bot_send_text_message = feishu_bot_send_text_message;
// ==================== 生命周期钩子 ====================
async function onFeishuListenerApplicationCreate() {
    try {
        logFeishuRuntime("listener create hook start");
        const snapshot = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
        if (!snapshot.app_id || !snapshot.app_secret) {
            logFeishuRuntime("listener create hook skipped: not configured");
            return { success: true, configured: false, started: false };
        }
        const result = await (0, feishu_service_js_1.ensureFeishuServiceStarted)(snapshot, {
            timeoutMs: feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS,
        });
        logFeishuRuntime(`listener create hook completed: started=${result.success}`);
        return {
            success: true,
            configured: true,
            started: result.success,
            result,
        };
    }
    catch (error) {
        console.error(`[feishu_runtime] listener create hook failed: ${(0, feishu_common_js_1.safeErrorMessage)(error)}`);
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.onFeishuListenerApplicationCreate = onFeishuListenerApplicationCreate;
async function onFeishuListenerApplicationForeground() {
    try {
        logFeishuRuntime("listener foreground hook start");
        const snapshot = await (0, feishu_state_js_1.readConfigSnapshotAsync)();
        if (!snapshot.app_id || !snapshot.app_secret) {
            logFeishuRuntime("listener foreground hook skipped: not configured");
            return { success: true, configured: false, started: false };
        }
        const result = await (0, feishu_service_js_1.ensureFeishuServiceStarted)(snapshot, {
            timeoutMs: feishu_common_js_1.DEFAULT_SERVICE_WAIT_MS,
        });
        logFeishuRuntime(`listener foreground hook completed: started=${result.success}`);
        return {
            success: true,
            configured: true,
            started: result.success,
            result,
        };
    }
    catch (error) {
        console.error(`[feishu_runtime] listener foreground hook failed: ${(0, feishu_common_js_1.safeErrorMessage)(error)}`);
        return {
            success: false,
            error: (0, feishu_common_js_1.safeErrorMessage)(error),
        };
    }
}
exports.onFeishuListenerApplicationForeground = onFeishuListenerApplicationForeground;
