/* METADATA
{
    "name": "feishu_bot",
    "display_name": {
        "zh": "飞书机器人",
        "en": "Feishu Bot"
    },
    "description": {
        "zh": "把飞书双向对话机器人的配置、后台 WebSocket 收消息服务、消息队列读取，以及消息发送能力整理成 Operit 工具。",
        "en": "Feishu Bot: configure, background WebSocket receive service, event queue, and message sending as Operit tools."
    },
    "enabledByDefault": true,
    "category": "Communication",
    "env": [
        {
            "name": "FEISHU_APP_ID",
            "description": { "zh": "飞书应用 AppID", "en": "Feishu App ID" },
            "required": false
        },
        {
            "name": "FEISHU_APP_SECRET",
            "description": { "zh": "飞书应用 AppSecret", "en": "Feishu App Secret" },
            "required": false
        },
        {
            "name": "FEISHU_MODEL_API_KEY",
            "description": { "zh": "模型 API Key", "en": "Model API Key" },
            "required": false
        },
        {
            "name": "FEISHU_MODEL_ENDPOINT",
            "description": { "zh": "模型 API 端点", "en": "Model API Endpoint" },
            "required": false
        },
        {
            "name": "FEISHU_MODEL_NAME",
            "description": { "zh": "模型名称", "en": "Model Name" },
            "required": false
        },
        {
            "name": "FEISHU_MODEL_CONFIG_ID",
            "description": { "zh": "从 Operit 导入的模型配置 id", "en": "Imported Operit model config id" },
            "required": false
        }
    ],
    "tools": [
        {
            "name": "usage_advice",
            "description": {
                "zh": "飞书机器人使用建议：\n- 先用 feishu_bot_configure 保存 AppID 和 AppSecret。\n- 在飞书开放平台启用 im:message 和 im:message:send_as_bot 权限。\n- 热加载后请手动调用 feishu_bot_service_start 拉起 WebSocket 收消息服务。\n- 收到消息后，用 feishu_bot_receive_events 取出事件，再把其中 open_id / message_id 传给发送工具。\n- 推荐在设置页用「从 Operit 导入模型」下拉选择模型，会自动填充 model_endpoint / model_name 并记录 model_config_id。\n- 模型 API Key 因 Operit 接口只返回掩码，首次需手动补填一次。\n- 也可直接调用 feishu_bot_configure 传 model_endpoint / model_name / model_config_id 切换模型。",
                "en": "Feishu Bot advice:\n- Save AppID and AppSecret with feishu_bot_configure first.\n- Enable im:message and im:message:send_as_bot permissions in Feishu Open Platform.\n- After hot reload, start the WebSocket receive service with feishu_bot_service_start.\n- Use feishu_bot_receive_events to dequeue inbound events, then pass open_id / message_id into the send tools.\n- Change model_endpoint and model_name via feishu_bot_configure to switch models."
            },
            "parameters": [],
            "advice": true
        },
        {
            "name": "feishu_bot_configure",
            "description": {
                "zh": "保存飞书机器人的 AppID、AppSecret、模型配置和沙箱开关；按需自动重启后台 WebSocket 收消息服务。",
                "en": "Persist Feishu Bot AppID, AppSecret, model config, and sandbox mode; optionally restart the background WebSocket receive service."
            },
            "parameters": [
                {
                    "name": "app_id",
                    "description": { "zh": "飞书应用 AppID", "en": "Feishu App ID" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "app_secret",
                    "description": { "zh": "飞书应用 AppSecret", "en": "Feishu App Secret" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "model_api_key",
                    "description": { "zh": "模型 API Key", "en": "Model API Key" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "model_endpoint",
                    "description": { "zh": "模型 API 端点", "en": "Model API Endpoint" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "model_name",
                    "description": { "zh": "模型名称", "en": "Model Name" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "model_config_id",
                    "description": { "zh": "从 Operit 导入的模型配置 id", "en": "Imported Operit model config id" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "use_sandbox",
                    "description": { "zh": "是否使用沙箱 OpenAPI", "en": "Whether to use sandbox OpenAPI" },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "test_connection",
                    "description": { "zh": "保存后是否立即测试凭证", "en": "Whether to test credentials after saving" },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "restart_service",
                    "description": { "zh": "保存后是否强制重启后台服务", "en": "Whether to force-restart the background service after saving" },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "feishu_bot_status",
            "description": {
                "zh": "读取当前飞书机器人配置摘要、后台服务状态和消息队列积压数量。",
                "en": "Read the current Feishu Bot config summary, background service status, and queued event count."
            },
            "parameters": []
        },
        {
            "name": "feishu_bot_service_start",
            "description": {
                "zh": "立即启动飞书机器人后台 WebSocket 收消息服务；可选强制重启。",
                "en": "Start the Feishu Bot background WebSocket receive service immediately; optionally force a restart."
            },
            "parameters": [
                {
                    "name": "restart",
                    "description": { "zh": "是否强制先停掉旧服务再重启", "en": "Whether to force-stop the previous service before starting" },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "timeout_ms",
                    "description": { "zh": "等待服务启动成功的超时毫秒数，默认 8000", "en": "Timeout in milliseconds while waiting for the service to become healthy, default 8000" },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "feishu_bot_service_stop",
            "description": {
                "zh": "停止当前飞书机器人后台 WebSocket 收消息服务。",
                "en": "Stop the current Feishu Bot background WebSocket receive service."
            },
            "parameters": [
                {
                    "name": "timeout_ms",
                    "description": { "zh": "等待服务停掉的超时毫秒数，默认 8000", "en": "Timeout in milliseconds while waiting for the service to stop, default 8000" },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "feishu_bot_receive_events",
            "description": {
                "zh": "从后台服务维护的事件队列里读取飞书机器人收到的事件；默认会消费并移除这些事件。",
                "en": "Read inbound Feishu Bot events from the queue maintained by the background service; by default the events are consumed and removed."
            },
            "parameters": [
                {
                    "name": "limit",
                    "description": { "zh": "最多取多少条事件，默认 20", "en": "Maximum number of events to return, default 20" },
                    "type": "number",
                    "required": false
                },
                {
                    "name": "consume",
                    "description": { "zh": "是否在读取后从队列移除，默认 true", "en": "Whether to remove the returned events from the queue, default true" },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "include_raw",
                    "description": { "zh": "是否返回 rawBody / rawPayload，默认 false", "en": "Whether to return rawBody / rawPayload, default false" },
                    "type": "boolean",
                    "required": false
                },
                {
                    "name": "auto_start",
                    "description": { "zh": "若服务未运行，是否自动尝试启动，默认 true", "en": "Whether to auto-start the service when it is not running, default true" },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "feishu_bot_clear_events",
            "description": {
                "zh": "清空当前飞书机器人事件队列。",
                "en": "Clear the current Feishu Bot event queue."
            },
            "parameters": []
        },
        {
            "name": "feishu_bot_test_connection",
            "description": {
                "zh": "验证 AppID/AppSecret 是否能正常获取 access token，并尝试获取 WebSocket 端点。",
                "en": "Verify whether AppID/AppSecret can obtain an access token and attempt to get the WebSocket endpoint."
            },
            "parameters": [
                {
                    "name": "timeout_ms",
                    "description": { "zh": "本次请求超时毫秒数（默认 20000）", "en": "Timeout for this request in milliseconds (default 20000)" },
                    "type": "number",
                    "required": false
                }
            ]
        },
        {
            "name": "feishu_bot_send_text_message",
            "description": {
                "zh": "向指定用户 open_id 发送一条文本消息，可用于主动消息，也可用于对已有 message_id 的被动回复。",
                "en": "Send one text message to a specific user open_id. Can be used as a proactive message or a passive reply to an existing message_id."
            },
            "parameters": [
                {
                    "name": "receive_id",
                    "description": { "zh": "目标用户 open_id", "en": "Target user open_id" },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "content",
                    "description": { "zh": "发送的文本内容", "en": "Text content to send" },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "receive_id_type",
                    "description": { "zh": "接收者类型，默认 open_id", "en": "Receiver ID type, default open_id" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "msg_id",
                    "description": { "zh": "可选：要回复的原消息 ID", "en": "Optional source message ID to reply to" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "timeout_ms",
                    "description": { "zh": "本次请求超时毫秒数（默认 20000）", "en": "Timeout for this request in milliseconds (default 20000)" },
                    "type": "number",
                    "required": false
                }
            ]
        }
    ]
}
*/
import {
    ensureFeishuServiceStarted,
    feishu_bot_configure,
    feishu_bot_status,
    feishu_bot_service_start,
    feishu_bot_service_stop,
    feishu_bot_receive_events,
    feishu_bot_clear_events,
    feishu_bot_test_connection,
    feishu_bot_send_text_message,
} from "../shared/feishu_runtime.js";

exports.ensureFeishuServiceStarted = ensureFeishuServiceStarted;
exports.feishu_bot_configure = feishu_bot_configure;
exports.feishu_bot_status = feishu_bot_status;
exports.feishu_bot_service_start = feishu_bot_service_start;
exports.feishu_bot_service_stop = feishu_bot_service_stop;
exports.feishu_bot_receive_events = feishu_bot_receive_events;
exports.feishu_bot_clear_events = feishu_bot_clear_events;
exports.feishu_bot_test_connection = feishu_bot_test_connection;
exports.feishu_bot_send_text_message = feishu_bot_send_text_message;