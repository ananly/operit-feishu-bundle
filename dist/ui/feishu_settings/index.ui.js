"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = feishuSettingsScreen;
const ZH = {
    title: "飞书机器人设置",
    appId: "App ID",
    appSecret: "App Secret",
    modelApiKey: "模型 API Key",
    modelEndpoint: "模型 API 地址",
    modelName: "模型名称",
    useSandbox: "使用沙箱环境",
    importModels: "从 Operit 导入模型",
    importingModels: "导入中...",
    selectModel: "选择模型",
    noModels: "未获取到模型，请先点「从 Operit 导入模型」",
    modelSelected: "已选择模型",
    currentModel: "当前模型",
    save: "保存",
    testConnection: "测试连接",
    startService: "启动服务",
    stopService: "停止服务",
    refresh: "刷新",
    status: "状态",
    notRunning: "未运行",
    running: "运行中",
    loading: "加载中...",
    saving: "保存中...",
    testing: "测试中...",
    starting: "启动中...",
    stopping: "停止中...",
    success: "成功",
    failed: "失败",
    connectionOk: "连接成功",
    connectionFailed: "连接失败",
    saveAndTest: "保存并测试",
    configured: "已配置",
    notConfigured: "未配置",
};
const EN = {
    title: "Feishu Bot Settings",
    appId: "App ID",
    appSecret: "App Secret",
    modelApiKey: "Model API Key",
    modelEndpoint: "Model API Endpoint",
    modelName: "Model Name",
    useSandbox: "Use Sandbox",
    importModels: "Import Models from Operit",
    importingModels: "Importing...",
    selectModel: "Select Model",
    noModels: "No model found, tap \"Import Models from Operit\" first",
    modelSelected: "Model selected",
    currentModel: "Current Model",
    save: "Save",
    testConnection: "Test Connection",
    startService: "Start Service",
    stopService: "Stop Service",
    refresh: "Refresh",
    status: "Status",
    notRunning: "Not Running",
    running: "Running",
    loading: "Loading...",
    saving: "Saving...",
    testing: "Testing...",
    starting: "Starting...",
    stopping: "Stopping...",
    success: "Success",
    failed: "Failed",
    connectionOk: "Connection OK",
    connectionFailed: "Connection Failed",
    saveAndTest: "Save & Test",
    configured: "Configured",
    notConfigured: "Not Configured",
};
function getLang() {
    try {
        const opCtx = globalThis.OperitContext;
        if (opCtx && typeof opCtx.getLang === "function") {
            return opCtx.getLang() === "zh" ? "zh" : "en";
        }
    }
    catch { }
    return "zh";
}
function resolveText() {
    return getLang() === "zh" ? ZH : EN;
}
function maskForDisplay(value) {
    if (!value)
        return "";
    if (value.length <= 6)
        return "******";
    return value.slice(0, 2) + "******" + value.slice(-2);
}
function asText(v) {
    if (v === null || v === undefined)
        return "";
    return String(v);
}
function buildStatusModel(result) {
    return {
        configured: !!result.configured,
        running: !!(result.service_running !== undefined ? result.service_running : result.running),
        appId: asText(result.app_id) || asText(result.appId) || asText(result.app_id_masked),
        modelName: asText(result.model_name) || asText(result.modelName) || "LongCat-2.0",
        modelEndpoint: asText(result.model_endpoint) ||
            asText(result.modelEndpoint) ||
            "https://api.longcat.chat/openai/v1/chat/completions",
        modelConfigId: asText(result.model_config_id) || asText(result.modelConfigId),
        useSandbox: !!(result.use_sandbox !== undefined ? result.use_sandbox : result.useSandbox),
        lastError: asText(result.lastError) || asText(result.error),
    };
}
const INITIAL_STATE = {
    loading: true,
    saving: false,
    starting: false,
    stopping: false,
    status: null,
    message: "",
    appId: "",
    appSecret: "",
    modelApiKey: "",
    modelEndpoint: "https://api.longcat.chat/openai/v1/chat/completions",
    modelName: "LongCat-2.0",
    modelConfigId: "",
    modelOptions: [],
    modelDropdownOpen: false,
    importingModels: false,
    useSandbox: false,
};
/* ─── UI ─── */
function buildScreen(ctx) {
    const t = resolveText();
    const UI = ctx.UI;
    const M = ctx.Modifier;
    const stateRef = ctx.useRef("feishuSettingsState", INITIAL_STATE);
    const tickRef = ctx.useRef("feishuSettingsTickRef", 0);
    const busyRef = ctx.useRef("feishuSettingsBusy", false);
    const loadedRef = ctx.useRef("feishuSettingsLoaded", false);
    const [, forceRender] = ctx.useState("feishuSettingsTick", 0);
    function patchState(patch) {
        stateRef.current = { ...stateRef.current, ...patch };
        tickRef.current = tickRef.current + 1;
        forceRender(tickRef.current);
    }
    async function loadStatus() {
        // 超时保护：避免 status 调用挂起导致“加载中”永久卡住
        const result = (await callToolWithTimeout("feishu_bot:feishu_bot_status", {}, 15000));
        return buildStatusModel(result || {});
    }
    async function doRefresh() {
        patchState({ loading: true, message: "" });
        try {
            const status = await loadStatus();
            patchState({
                status,
                appId: stateRef.current.appId || status.appId,
                modelName: status.modelName,
                modelEndpoint: status.modelEndpoint,
                modelConfigId: status.modelConfigId,
                useSandbox: status.useSandbox,
                message: "",
            });
        }
        catch (e) {
            patchState({ message: safeErrorMessage(e) });
        }
        finally {
            patchState({ loading: false });
        }
    }
    // 从 Operit 软件设置导入模型列表（动态，支持模型持续增多）
    async function importModelsFromOperit() {
        if (busyRef.current)
            return;
        busyRef.current = true;
        patchState({ importingModels: true, message: "" });
        try {
            let res;
            // 优先走官方沙箱 API（类型库已声明），失败再回退到主机工具名
            const anyGlobal = globalThis;
            const listFn = anyGlobal.Tools?.SoftwareSettings?.listModelConfigs;
            if (typeof listFn === "function") {
                res = await callFnWithTimeout(() => listFn.call(anyGlobal.Tools?.SoftwareSettings), 15000);
            }
            else {
                res = (await callToolWithTimeout("list_model_configs", {}, 15000));
            }
            const configs = Array.isArray(res && res.configs)
                ? res.configs
                : [];
            const options = configs.map((c) => ({
                id: asText(c.id),
                name: asText(c.name) || asText(c.id),
                modelName: asText(c.modelName) || asText(c.model_name),
                apiEndpoint: asText(c.apiEndpoint) || asText(c.api_endpoint),
                apiKeyPreview: asText(c.apiKeyPreview) || asText(c.api_key_preview),
            }));
            patchState({
                modelOptions: options,
                modelDropdownOpen: options.length > 0,
                message: options.length === 0 ? t.noModels : "",
            });
        }
        catch (e) {
            patchState({
                modelOptions: [],
                message: safeErrorMessage(e) === "__TIMEOUT__"
                    ? t.noModels
                    : safeErrorMessage(e),
            });
        }
        finally {
            patchState({ importingModels: false });
            busyRef.current = false;
        }
    }
    // 选中某个模型后自动填充 endpoint / name / configId
    function handleSelectModel(id) {
        const opt = stateRef.current.modelOptions.find((m) => m.id === id);
        if (!opt) {
            patchState({ modelDropdownOpen: false });
            return;
        }
        patchState({
            modelConfigId: opt.id,
            modelEndpoint: opt.apiEndpoint,
            modelName: opt.modelName,
            modelDropdownOpen: false,
            message: `${t.modelSelected}: ${opt.name}`,
        });
    }
    function isMasked(value) {
        return /^.{2}\*{6}.{2}$/.test(value) || value === "******";
    }
    function buildConfigureParams(s, withTest) {
        const params = {
            app_id: s.appId,
            model_endpoint: s.modelEndpoint,
            model_name: s.modelName,
            use_sandbox: s.useSandbox,
        };
        // 记录模型来源，便于后续从 Operit 侧读取 Key / 自动同步
        if (s.modelConfigId)
            params.model_config_id = s.modelConfigId;
        // 输入框为明文密码框，有值即视为用户填写的真实密钥，直接提交。
        // 注意：不再用掩码判断，因为一旦用掩码会挡住真实密钥导致 configured 永远 false。
        if (s.appSecret)
            params.app_secret = s.appSecret;
        if (s.modelApiKey)
            params.model_api_key = s.modelApiKey;
        if (withTest)
            params.test_connection = true;
        return params;
    }
    // 给任意 Promise 工厂包一层超时（用于沙箱 API 直调）
    function callFnWithTimeout(fn, ms) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                reject(new Error("__TIMEOUT__"));
            }, ms);
            Promise.resolve()
                .then(fn)
                .then((v) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve(v);
            })
                .catch((e) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                reject(e);
            });
        });
    }
    // 给 callTool 包一层超时，避免调用挂起时按钮永久卡住
    function callToolWithTimeout(name, params, timeoutMs) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                reject(new Error("__TIMEOUT__"));
            }, timeoutMs);
            Promise.resolve(ctx.callTool(name, params))
                .then((r) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve((r || {}));
            })
                .catch((e) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                reject(e);
            });
        });
    }
    async function handleAction(action) {
        if (busyRef.current)
            return;
        busyRef.current = true;
        const s = stateRef.current;
        if (action === "refresh") {
            try {
                await doRefresh();
            }
            finally {
                busyRef.current = false;
            }
            return;
        }
        const flags = {};
        if (action === "save_credentials")
            flags.saving = true;
        if (action === "save_and_test")
            flags.saving = true;
        if (action === "start_service")
            flags.starting = true;
        if (action === "stop_service")
            flags.stopping = true;
        patchState({ ...flags, message: "" });
        try {
            let result = null;
            if (action === "start_service") {
                result = await callToolWithTimeout("feishu_bot:feishu_bot_service_start", { restart: true }, 30000);
            }
            else if (action === "stop_service") {
                result = await callToolWithTimeout("feishu_bot:feishu_bot_service_stop", {}, 30000);
            }
            else {
                result = await callToolWithTimeout("feishu_bot:feishu_bot_configure", buildConfigureParams(s, action === "save_and_test"), 30000);
            }
            const success = !!(result && result.success);
            if (action === "save_and_test") {
                const conn = result && result.connection
                    ? result.connection
                    : undefined;
                patchState({
                    message: success
                        ? (conn && conn.success ? t.connectionOk : t.connectionFailed)
                        : safeErrorMessage(result && result.error),
                });
            }
            else {
                patchState({
                    message: success ? t.success : safeErrorMessage(result && result.error),
                });
            }
        }
        catch (e) {
            patchState({ message: safeErrorMessage(e) });
        }
        finally {
            patchState({
                loading: false,
                saving: false,
                starting: false,
                stopping: false,
            });
            busyRef.current = false;
        }
    }
    // 首次渲染加载
    if (stateRef.current.status === null && !loadedRef.current) {
        loadedRef.current = true;
        void doRefresh();
    }
    const s = stateRef.current;
    const statusText = s.loading
        ? t.loading
        : s.status && s.status.running
            ? t.running
            : t.notRunning;
    const statusColor = s.status && s.status.running ? "#2E7D32" : "#C62828";
    const configText = s.status && s.status.configured ? t.configured : t.notConfigured;
    const messageColor = s.message &&
        (s.message.indexOf(t.success) >= 0 || s.message.indexOf(t.connectionOk) >= 0)
        ? "#2E7D32"
        : "#C62828";
    const children = [];
    children.push(UI.Text({ text: t.title, fontSize: 20, fontWeight: "bold" }));
    children.push(M.padding(4) ? placeholderSpacer(UI) : placeholderSpacer(UI));
    // 输入区
    children.push(UI.TextField({
        modifier: M.fillMaxWidth().padding(4),
        label: t.appId,
        value: s.appId,
        onValueChange: (v) => {
            stateRef.current.appId = v;
            tickRef.current = tickRef.current + 1;
            forceRender(tickRef.current);
        },
    }));
    children.push(UI.TextField({
        modifier: M.fillMaxWidth().padding(4),
        label: t.appSecret,
        value: s.appSecret,
        isPassword: true,
        onValueChange: (v) => {
            stateRef.current.appSecret = v;
            tickRef.current = tickRef.current + 1;
            forceRender(tickRef.current);
        },
    }));
    children.push(UI.TextField({
        modifier: M.fillMaxWidth().padding(4),
        label: t.modelApiKey,
        value: s.modelApiKey,
        isPassword: true,
        onValueChange: (v) => {
            stateRef.current.modelApiKey = v;
            tickRef.current = tickRef.current + 1;
            forceRender(tickRef.current);
        },
    }));
    // 模型导入与选择（方案 A：从 Operit 导入模型列表，选中后自动填充）
    children.push(UI.Row({ modifier: M.fillMaxWidth().padding(4) }, [
        UI.Button({
            text: s.importingModels ? t.importingModels : t.importModels,
            onClick: () => {
                void importModelsFromOperit();
            },
            enabled: !s.importingModels,
        }),
    ]));
    // 当前模型回显
    children.push(UI.Text({
        text: `${t.currentModel}: ${s.modelName || "-"}  (${s.modelConfigId || "-"})`,
        fontSize: 13,
    }));
    // 下拉选择模型
    const modelMenuChildren = s.modelOptions.map((opt) => UI.Row({
        modifier: M.fillMaxWidth().padding(2),
        onClick: () => {
            handleSelectModel(opt.id);
        },
    }, [
        UI.ListItem({
            headlineContent: UI.Text({ text: `${opt.name}  ·  ${opt.modelName}` }),
            supportingContent: UI.Text({ text: `${opt.apiEndpoint}  ${opt.apiKeyPreview}` }),
        }),
    ]));
    children.push(UI.Box({ modifier: M.fillMaxWidth().padding(4) }, [
        UI.Button({
            text: s.modelOptions.length === 0
                ? t.noModels
                : `${t.selectModel} (${s.modelOptions.length})`,
            onClick: () => {
                patchState({ modelDropdownOpen: !s.modelDropdownOpen });
            },
            enabled: s.modelOptions.length > 0,
        }),
        UI.DropdownMenu({
            expanded: s.modelDropdownOpen,
            onDismissRequest: () => {
                patchState({ modelDropdownOpen: false });
            },
            content: modelMenuChildren,
        }),
    ]));
    // 沙箱开关
    children.push(UI.Row({ modifier: M.fillMaxWidth().padding(4) }, [
        UI.Text({ text: t.useSandbox }),
        UI.Switch({
            checked: s.useSandbox,
            onCheckedChange: (v) => {
                stateRef.current.useSandbox = v;
                tickRef.current = tickRef.current + 1;
                forceRender(tickRef.current);
            },
        }),
    ]));
    // 消息
    if (s.message) {
        children.push(UI.Text({ text: s.message, color: messageColor }));
    }
    // 操作按钮
    children.push(UI.Row({ modifier: M.fillMaxWidth().padding(4) }, [
        UI.Button({
            text: s.saving ? t.saving : t.save,
            onClick: () => {
                void handleAction("save_credentials");
            },
        }, undefined),
        UI.Button({
            text: s.saving ? t.saving : t.saveAndTest,
            onClick: () => {
                void handleAction("save_and_test");
            },
        }, undefined),
        UI.Button({
            text: s.loading ? t.loading : t.refresh,
            onClick: () => {
                void handleAction("refresh");
            },
        }, undefined),
    ]));
    // 服务控制
    children.push(UI.Row({ modifier: M.fillMaxWidth().padding(4) }, [
        UI.Button({
            text: s.starting ? t.starting : t.startService,
            onClick: () => {
                void handleAction("start_service");
            },
        }, undefined),
        UI.Button({
            text: s.stopping ? t.stopping : t.stopService,
            onClick: () => {
                void handleAction("stop_service");
            },
        }, undefined),
    ]));
    // 状态卡片（移到按钮下方）
    children.push(UI.Card({ modifier: M.fillMaxWidth(), padding: 12 }, [
        UI.Row({ modifier: M.fillMaxWidth() }, [
            UI.Text({ text: t.status + ": ", fontWeight: "bold" }),
            UI.Text({ text: statusText, color: statusColor }),
        ]),
        UI.Row({ modifier: M.fillMaxWidth() }, [
            UI.Text({ text: configText, color: "#555555" }),
        ]),
    ]));
    return UI.Column({ modifier: M.fillMaxSize().padding(16), spacing: 4 }, children);
}
function placeholderSpacer(UI) {
    return UI.Spacer({ height: 4 });
}
function feishuSettingsScreen(ctx) {
    return buildScreen(ctx);
}
function safeErrorMessage(error) {
    const common = require("../../shared/feishu_common.js");
    return common.safeErrorMessage(error);
}
