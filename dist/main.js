"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = exports.feishuListenerApplicationForeground = exports.feishuListenerApplicationCreate = void 0;
const index_ui_js_1 = require("./ui/feishu_settings/index.ui.js");
const feishu_runtime_js_1 = require("./shared/feishu_runtime.js");
function logFeishuStartup(message) {
    console.log(`[feishu_bot] ${message}`);
}
// Wrappers to satisfy AppLifecycleHookHandler type.
// The underlying hooks return Promise<FeishuActionResult> which contains
// [key: string]: unknown — not assignable to AppLifecycleHookReturn.
// Wrapping as Promise<void> resolves the type mismatch.
async function feishuListenerApplicationCreate() {
    await (0, feishu_runtime_js_1.onFeishuListenerApplicationCreate)();
}
exports.feishuListenerApplicationCreate = feishuListenerApplicationCreate;
async function feishuListenerApplicationForeground() {
    await (0, feishu_runtime_js_1.onFeishuListenerApplicationForeground)();
}
exports.feishuListenerApplicationForeground = feishuListenerApplicationForeground;
function registerToolPkg() {
    logFeishuStartup("registerToolPkg start");
    // 注册工具箱设置界面
    ToolPkg.registerToolboxUiModule({
        id: "feishu_settings",
        runtime: "compose_dsl",
        screen: index_ui_js_1.default,
        params: {},
        title: {
            zh: "飞书机器人设置",
            en: "Feishu Bot Settings",
        },
    });
    // 注册应用生命周期钩子
    ToolPkg.registerAppLifecycleHook({
        id: "feishu_listener_app_create",
        event: "application_on_create",
        function: feishuListenerApplicationCreate,
    });
    ToolPkg.registerAppLifecycleHook({
        id: "feishu_listener_app_foreground",
        event: "application_on_foreground",
        function: feishuListenerApplicationForeground,
    });
    logFeishuStartup("registerToolPkg done");
    return true;
}
exports.registerToolPkg = registerToolPkg;
