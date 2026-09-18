import feishuSettingsScreen from "./ui/feishu_settings/index.ui.js";
import {
  onFeishuListenerApplicationCreate as _createHook,
  onFeishuListenerApplicationForeground as _foregroundHook,
} from "./shared/feishu_runtime.js";

function logFeishuStartup(message: string): void {
  console.log(`[feishu_bot] ${message}`);
}

// Wrappers to satisfy AppLifecycleHookHandler type.
// The underlying hooks return Promise<FeishuActionResult> which contains
// [key: string]: unknown — not assignable to AppLifecycleHookReturn.
// Wrapping as Promise<void> resolves the type mismatch.
export async function feishuListenerApplicationCreate(): Promise<void> {
  await _createHook();
}

export async function feishuListenerApplicationForeground(): Promise<void> {
  await _foregroundHook();
}

export function registerToolPkg(): boolean {
  logFeishuStartup("registerToolPkg start");

  // 注册工具箱设置界面
  ToolPkg.registerToolboxUiModule({
    id: "feishu_settings",
    runtime: "compose_dsl",
    screen: feishuSettingsScreen,
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