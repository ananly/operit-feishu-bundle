# Feishu Bot Bundle · 飞书机器人工具包

> Operit ToolPkg：把飞书自建应用的双向对话机器人能力，整理成 Operit 可调用的工具。
> 支持 WebSocket 长连接收消息、消息队列读取、C2C/群消息发送、多模型 API 配置切换。

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](./manifest.json)
[![Platform](https://img.shields.io/badge/platform-Operit-green)](https://github.com/ananly)
[![License](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)

---

## ✨ 功能特性

| 工具 | 说明 |
|---|---|
| `feishu_bot_configure` | 保存 AppID / AppSecret / 模型配置，可自动重启服务 |
| `feishu_bot_status` | 读取配置摘要、服务状态、消息队列积压 |
| `feishu_bot_service_start` | 启动 WebSocket 收消息服务（支持强制重启换票） |
| `feishu_bot_service_stop` | 停止后台服务 |
| `feishu_bot_receive_events` | 读取事件队列（默认消费） |
| `feishu_bot_clear_events` | 清空事件队列 |
| `feishu_bot_test_connection` | 验证凭证并获取 WS 端点 |
| `feishu_bot_send_text_message` | 发送文本消息 / 被动回复 |

**内置能力：**
- 🔌 **异步解耦**：首帧 ACK 立即回（`biz_rt=1`），模型生成后异步发送 + 完成 ACK，规避飞书 ~19s 重投窗口
- 🔁 **消息去重**：服务端固定重投策略下，`[Dedup]` 兜底保证只回复一次
- 🔄 **多模型热切换**：DeepSeek / GLM / LongCat 等任意 OpenAI 兼容端点，改配置即生效
- 🧩 **Operit 模型库联动**：传 `model_config_id` 自动同步对应 API Key

---

## 🚀 快速开始

### 1. 飞书后台准备

1. 在 [飞书开放平台](https://open.feishu.cn/) 创建**自建应用**
2. 开启权限：`im:message`、`im:message:send_as_bot`
3. 事件订阅选择**长连接**方式
4. 记录 `AppID` / `AppSecret`

### 2. 配置机器人

```jsonc
// feishu_bot_configure 参数
{
  "app_id": "cli_xxxx",
  "app_secret": "xxxx",
  "model_endpoint": "https://api.deepseek.com/v1/chat/completions",
  "model_name": "deepseek-v4-flash",
  "model_config_id": "default",   // 可选：从 Operit 模型库按 id 取 key
  "use_sandbox": true
}
```

### 3. 启动服务

```
feishu_bot_service_start(restart: true)
```

---

## ⚙️ 多模型切换基准（实测）

| 模型 | 端点 | 端到端延迟 | 备注 |
|---|---|---|---|
| `glm-4-flash` | `open.bigmodel.cn/api/paas/v4` | ~2s | 免费可用 |
| `deepseek-v4-flash` | `api.deepseek.com/v1` | ~3s | 直连最快 |
| `LongCat-2.0` | `api.longcat.chat/openai/v1` | ~4s | 推理模型（带思维链） |

> 切换模型时**必须同时显式传 `model_endpoint` + `model_name`**，否则只换 `model_config_id` 会导致 key/endpoint 错配。

---

## ⚠️ 重要踩坑记录（血泪教训）

### 坑 1：改配置文件永远不生效 —— 内存缓存陷阱 🔴

**现象**：直接编辑 `feishu_config.json` 里的 `model_name`，重启网关服务后，进程启动参数仍是旧值。

**根因**：包运行时读配置走**内存缓存**，一旦加载就不再回读文件：

```js
async function readCachedJsonStoreAsync(path, sanitize) {
    const entry = getCachedJsonStoreEntry(path);
    if (!entry.loaded) {              // ← 只在首次加载时读文件
        const raw = await readJsonObjectFileAsync(path);
        entry.value = ...; entry.loaded = true;
    }
    return cloneJsonObject(entry.value);  // ← 之后永远返回内存快照
}
```

Operit 主进程一直存活，所以缓存里的值永不刷新。**重启飞书网关子进程也没用**，因为缓存属于主进程。

**正确做法**：✅ 通过 `feishu_bot_configure` 工具修改（走 `updatePersistedConfigAsync`，同时更新内存 + 落盘）；❌ 不要直接编辑 config 文件。

### 坑 2：切换配置后 WebSocket 401 —— 票据一次性 🔴

**现象**：`feishu_bot_configure` 后服务重连，报：

```
WS 错误: Handshake status 401 Unauthorized
handshake-autherrcode: 1000040348  (auth resp code error)
```

退出码反复重连，退避 3→6→12s，永不成功。

**根因**：每次调 configure 都会**重新申请 WS 端点（新 ticket）**，但旧连接仍持有旧 ticket。飞书 ticket 是**一次性**的，旧连接被踢 + 新 ticket 冲突 → 授权链断裂，票据作废。

**正确做法**：配置变更后用 `feishu_bot_service_start(restart: true)` **强制全新启动**，它会重新申请 ticket。（单纯 `stop` 可能被守护进程拉活，杀不干净）

### 坑 3：`model_config_id` 只同步 API Key，不同步 endpoint/name 🟡

**根因**（`feishu_runtime.js`）：

```js
const hit = ds.entries.find(e => e.id === targetConfigId);
if (hit && hit.apiKey) {
    await updatePersistedConfigAsync({ model_api_key: hit.apiKey });  // 只写 key！
}
```

切模型时若只传 `model_config_id`，会出现 **endpoint 是旧的、key 是新的** 的错配，请求必然失败。

**正确做法**：切换时同时传 `model_endpoint` + `model_name` + `model_config_id` 三件套。

---

## 🐛 已知问题（Known Issues）

> 以下为实测中观察到的平台侧/工具调用层行为，**不影响功能使用**，但需按规避方式操作。

### 1. 部分工具调用返回空 `<error>`（`Step error`）🟡

**现象**：以下调用偶发返回空白错误，无有效信息：

- `feishu_bot_service_stop` —— 无参数工具易触发
- `feishu_bot_configure` 传入含 `uuid` 格式的 `model_config_id` 时
- 传入超长参数值时
- `feishu_bot_configure` 携带 `test_connection: true` 时

**推测原因**：平台工具调用层对**无参调用 / uuid 参数 / 超长值**存在 schema 过滤或校验限制，具体规则未公开。

**规避方式**：

| 场景 | 规避 |
|---|---|
| 需要停服务 | 改用 `feishu_bot_service_start(restart: true)` 一步完成停+启 |
| 切模型（含 uuid id） | **分步调用**：先只传 `model_config_id` + `model_name`，避免一次传三个字段 |
| 想测连接 | 去掉 `test_connection`，改用 `feishu_bot_test_connection` 单独测 |
| 仍失败 | 简化参数（减少字段数）后重试，通常可绕过 |

### 2. `feishu_bot_service_stop` 可能"停不掉" 🟡

**现象**：调用 stop 后服务很快又被拉起。

**原因**：包内守护逻辑 `ensureFeishuServiceStarted` 会在检测到服务停止时自动重启；此外网关进程运行在 proot 容器内，**宿主侧 `ps`/`kill` 看不到其真实 PID**，无法从外部强杀。

**规避方式**：不要依赖 stop，直接用 `feishu_bot_service_start(restart: true)` 显式重启。

---

## 📁 项目结构

```
.
├── manifest.json                    # ToolPkg 清单
├── src/                             # TypeScript 源码
│   ├── main.ts
│   ├── packages/feishu_bot.ts       # 工具入口
│   ├── shared/
│   │   ├── feishu_common.ts         # 常量 / 工具函数
│   │   ├── feishu_openapi.ts        # 飞书 OpenAPI 封装
│   │   ├── feishu_runtime.ts        # configure 逻辑 + DataStore 读取
│   │   ├── feishu_service.ts        # 网关进程生命周期
│   │   └── feishu_state.ts          # 配置读写（含内存缓存）
│   └── ui/feishu_settings/index.ui.ts
├── dist/                            # 编译产物（与 src 同步）
└── resources/
    └── feishu_gateway_service.py    # 网关服务（WS 长连接 + 模型调用）
```

---

## 🔒 安全说明

- ⚠️ 本项目**不包含任何真实凭据**；示例中的 `cli_xxxx` / API Key 均为占位符
- 配置文件位于 `ToolPkg.getConfigDir("com.operit.feishu_bundle")/feishu_config.json`，请勿提交至公开仓库
- 建议在 `.gitignore` 中排除 `feishu_config.json`、`*.log`、`__pycache__/`

---

## 📄 License

[MIT](./LICENSE)

---

## 🙏 致谢

基于 [Operit](https://github.com/ananly) 平台 ToolPkg 体系开发。
