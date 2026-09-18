import {
  DEFAULT_WS_CONFIG,
  FeishuConfigSnapshot,
  asText,
  firstNonBlank,
  hasOwn,
  isObject,
  parseJsonObject,
  parsePositiveInt,
  safeErrorMessage,
  shellQuote,
  toBoolean,
  fetchCompat,
} from "./feishu_common.js";
import {
  buildStatus,
  deleteFileIfExistsAsync,
  getServiceLogPath,
  getStateDirectoryPath,
  readConfigSnapshotAsync,
  readTextFileWithTools,
  writeServiceStateAsync,
} from "./feishu_state.js";
import {
  fetchTenantAccessToken,
  fetchWsEndpoint,
} from "./feishu_openapi.js";

const HIDDEN_TERMINAL_EXECUTOR_KEY = "feishu_gateway_service";

function getLocalServiceBaseUrl(): string {
  return `http://127.0.0.1:18790`;
}

async function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timerId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timerId != null) {
      clearTimeout(timerId);
    }
  }
}

async function sleepMsAsync(ms: number): Promise<void> {
  await Tools.System.sleep(ms);
}

async function runTerminalCommand(command: string, timeoutMs: number): Promise<any> {
  return await Tools.System.terminal.hiddenExec(command, {
    executorKey: HIDDEN_TERMINAL_EXECUTOR_KEY,
    timeoutMs,
  });
}

async function ensureTerminalPythonAvailable(): Promise<void> {
  const result = await runTerminalCommand(
    "python3 - <<'PY'\nimport http.server, json, os, socket, ssl, sys, threading, urllib.request, websocket\nprint('__PY_OK__')\nPY",
    15000
  );
  if (Number(result.exitCode || 0) !== 0 || !asText(result.output).includes("__PY_OK__")) {
    throw new Error(firstNonBlank(asText(result.output).trim(), "python3 with websocket is required for feishu gateway service"));
  }
}

async function readGatewayServiceScriptPath(): Promise<string> {
  return await ToolPkg.readResource(
    "feishu_gateway_service_py",
    "feishu_gateway_service.py",
    true
  );
}

function parseProcessPids(output: string): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/g);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || !/^\d+$/.test(line) || seen.has(line)) {
      continue;
    }
    seen.add(line);
    matches.push(line);
  }
  return matches;
}

async function readPidFilePid(): Promise<string[]> {
  const candidates = [
    `${getStateDirectoryPath()}/feishu_gateway.pid`,
    "/data/user/0/com.ai.assistance.operit/cache/Operit/cleanOnExit/feishu_gateway.pid",
  ];
  for (const p of candidates) {
    try {
      const content = await Tools.Files.read(p);
      const m = asText(content && content.content).match(/\d+/);
      if (m) return [m[0]];
    } catch {}
  }
  return [];
}
async function getRunningPids(): Promise<string[]> {
  const result = await runTerminalCommand(
    "python3 -c \"import glob; print('\\n'.join([p.split('/')[-1] for p in glob.glob('/proc/[0-9]*/cmdline') if 'feishu_gateway' in open(p,'rb').read().decode('utf-8','replace')]))\"",
    5000
  );
  const pids = parseProcessPids(asText(result.output));
  if (pids.length > 0) return pids;
  // fix: sandbox /proc may be invisible; fall back to PID file + live health check
  const healthy = await isServiceHealthy();
  if (healthy) {
    const filePids = await readPidFilePid();
    if (filePids.length > 0) return filePids;
  }
  return [];
}

async function isServiceHealthy(): Promise<boolean> {
  try {
    const response = await fetchCompat(`${getLocalServiceBaseUrl()}/health`, {
      method: "GET",
      timeout: 3000,
    });
    if (!response.ok) return false;
    const text = await response.text();
    return text.includes("ok") || text.includes("OK");
  } catch {
    return false;
  }
}

async function getServiceStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetchCompat(`${getLocalServiceBaseUrl()}/status`, {
      method: "GET",
      timeout: 3000,
    });
    if (!response.ok) return { running: false };
    const text = await response.text();
    return parseJsonObject(text);
  } catch {
    return { running: false };
  }
}

async function readQueuedEventsFromService(): Promise<Record<string, unknown>[]> {
  try {
    const response = await fetchCompat(`${getLocalServiceBaseUrl()}/events`, {
      method: "GET",
      timeout: 5000,
    });
    if (!response.ok) return [];
    const text = await response.text();
    const json = parseJsonObject(text);
    return Array.isArray(json.events) ? json.events : [];
  } catch {
    return [];
  }
}

async function deleteQueuedEventsLocal(): Promise<void> {
  try {
    await fetchCompat(`${getLocalServiceBaseUrl()}/events`, {
      method: "DELETE",
      timeout: 5000,
    });
  } catch {}
}

async function removeAcknowledgedEvents(count: number): Promise<void> {
  try {
    await fetchCompat(`${getLocalServiceBaseUrl()}/events/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
      timeout: 5000,
    });
  } catch {}
}

async function writeToServiceLog(message: string): Promise<void> {
  const logPath = getServiceLogPath();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    const existing = await readTextFileWithTools(logPath);
    await Tools.Files.write(logPath, existing + line);
  } catch {
    await Tools.Files.write(logPath, line);
  }
}

export async function ensureFeishuServiceStarted(
  config: FeishuConfigSnapshot,
  options: { restart?: boolean; timeoutMs?: number } = {}
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs || 4000;
  const restart = toBoolean(options.restart, false);
  const startTime = Date.now();

  await writeToServiceLog("ensureFeishuServiceStarted: start");

  // 检查是否已运行
  const existingPids = await getRunningPids();
  if (existingPids.length > 0) {
    if (!restart) {
      const healthy = await isServiceHealthy();
      if (healthy) {
        await writeToServiceLog("ensureFeishuServiceStarted: already running and healthy");
        await writeServiceStateAsync({ running: true, pid: existingPids[0] || null, lastStartTime: new Date().toISOString() });
        return { success: true, pid: existingPids[0], alreadyRunning: true };
      }
    }
    // 停止旧实例
    await stopFeishuServiceInternal(existingPids);
  }

  // 获取 WS 端点
  const wsEndpointResult = await fetchWsEndpoint(
    config.app_id || "",
    config.app_secret || "",
    toBoolean(config.use_sandbox, false)
  );
  if (wsEndpointResult.code !== 0 || !wsEndpointResult.data?.url) {
    throw new Error(`Failed to get WS endpoint: ${wsEndpointResult.msg || "unknown error"}`);
  }

  // 获取 tenant_access_token
  const tokenResult = await fetchTenantAccessToken(
    config.app_id || "",
    config.app_secret || "",
    toBoolean(config.use_sandbox, false)
  );
  if (tokenResult.code !== 0 || !tokenResult.tenant_access_token) {
    throw new Error(`Failed to get tenant_access_token: ${tokenResult.msg || "unknown error"}`);
  }

  // 获取网关脚本路径
  const scriptPath = await readGatewayServiceScriptPath();

  // 启动服务
  const wsUrl = wsEndpointResult.data.url;
  const token = tokenResult.tenant_access_token;
  const modelApiKey = config.model_api_key || "";
  // 修正笔误：原 openv1 -> openai/v1
  const modelEndpoint = config.model_endpoint || "https://api.longcat.chat/openai/v1/chat/completions";
  const modelName = config.model_name || "LongCat-2.0";

  const startCmd = `python3 ${scriptPath} --port 18790 --ws-url ${shellQuote(wsUrl)} --token ${shellQuote(token)} --app-id ${shellQuote(config.app_id || "")} --app-secret ${shellQuote(config.app_secret || "")} --model-api-key ${shellQuote(modelApiKey)} --model-endpoint ${shellQuote(modelEndpoint)} --model-name ${shellQuote(modelName)} --log-file ${shellQuote(getServiceLogPath())} &`;
  
  await writeToServiceLog(`Starting gateway service: ${startCmd}`);
  const startResult = await runTerminalCommand(startCmd, 10000);
  
  if (Number(startResult.exitCode || 0) !== 0) {
    throw new Error(`Failed to start gateway service: ${asText(startResult.output)}`);
  }

  // 等待服务就绪
  const deadline = startTime + timeoutMs;
  while (Date.now() < deadline) {
    await sleepMsAsync(500);
    const healthy = await isServiceHealthy();
    if (healthy) {
      const pids = await getRunningPids();
      await writeToServiceLog(`ensureFeishuServiceStarted: healthy, pid=${pids[0]}`);
      await writeServiceStateAsync({ running: true, pid: pids[0] || null, lastStartTime: new Date().toISOString() });
      return { success: true, pid: pids[0], alreadyRunning: false };
    }
  }

  throw new Error(`Service did not become healthy within ${timeoutMs}ms`);
}

export async function stopFeishuServiceInternal(
  pids?: string[]
): Promise<{ success: boolean; stoppedPids: string[] }> {
  const targetPids = pids || await getRunningPids();
  if (targetPids.length === 0) {
    return { success: true, stoppedPids: [] };
  }

  for (const pid of targetPids) {
    await runTerminalCommand(`kill ${pid} 2>/dev/null || true`, 3000);
  }

  // 等待进程退出
  await sleepMsAsync(1000);
  const remaining = await getRunningPids();
  return { success: remaining.length === 0, stoppedPids: targetPids };
}

export async function queryQueuedEventsFromService(
  params: { limit?: number; consume?: boolean; include_raw?: boolean } = {}
): Promise<{ returnedCount: number; remainingCount: number; events: Record<string, unknown>[] }> {
  const events = await readQueuedEventsFromService();
  const limit = params.limit || 20;
  const consume = toBoolean(params.consume, true);

  const sliced = events.slice(0, limit);
  
  if (consume && sliced.length > 0) {
    // 从服务中移除已消费的事件
    try {
      await fetchCompat(`${getLocalServiceBaseUrl()}/events/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: sliced.length }),
        timeout: 5000,
      });
    } catch {}
  }

  return {
    returnedCount: sliced.length,
    remainingCount: Math.max(0, events.length - sliced.length),
    events: sliced,
  };
}

export async function clearQueuedEventsFromService(): Promise<{ cleared: number }> {
  const before = await readQueuedEventsFromService();
  await deleteQueuedEventsLocal();
  return { cleared: before.length };
}