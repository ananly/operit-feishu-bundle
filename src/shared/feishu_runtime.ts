import {
  FeishuConfigSnapshot,
  FeishuActionResult,
  asText,
  firstNonBlank,
  hasOwn,
  parseOptionalBoolean,
  parsePositiveInt,
  safeErrorMessage,
  toBoolean,
  DEFAULT_SERVICE_WAIT_MS,
  DEFAULT_RECEIVE_LIMIT,
  MAX_RECEIVE_LIMIT,
} from "./feishu_common.js";
import {
  buildStatus,
  readConfigSnapshotAsync,
  requireConfiguredSnapshotAsync,
  updatePersistedConfigAsync,
  writeEnv,
} from "./feishu_state.js";
import {
  fetchTenantAccessToken,
  fetchWsEndpoint,
  sendMessage,
  replyMessage,
  openApiRequest,
  resolveTimeoutMs,
} from "./feishu_openapi.js";
import {
  ensureFeishuServiceStarted,
  stopFeishuServiceInternal,
  queryQueuedEventsFromService,
  clearQueuedEventsFromService,
} from "./feishu_service.js";

function logFeishuRuntime(message: string): void {
  console.log(`[feishu_runtime] ${message}`);
}

function previewJson(value: unknown, maxLength = 1200): string {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "[unserializable]";
  }
}

// ==================== 工具函数实现 ====================

async function feishu_bot_configure(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const before = await readConfigSnapshotAsync();
    const updatedConfigFields: string[] = [];

    // 更新配置字段
    if (hasOwn(params, "app_id")) {
      await updatePersistedConfigAsync({ app_id: asText(params.app_id).trim() });
      updatedConfigFields.push("app_id");
    }
    if (hasOwn(params, "app_secret")) {
      await updatePersistedConfigAsync({ app_secret: asText(params.app_secret).trim() });
      updatedConfigFields.push("app_secret");
    }
    if (hasOwn(params, "model_api_key")) {
      await updatePersistedConfigAsync({ model_api_key: asText(params.model_api_key).trim() });
      updatedConfigFields.push("model_api_key");
    }
    if (hasOwn(params, "model_endpoint")) {
      await updatePersistedConfigAsync({ model_endpoint: asText(params.model_endpoint).trim() });
      updatedConfigFields.push("model_endpoint");
    }
    if (hasOwn(params, "model_name")) {
      await updatePersistedConfigAsync({ model_name: asText(params.model_name).trim() });
      updatedConfigFields.push("model_name");
    }
    if (hasOwn(params, "model_config_id")) {
      await updatePersistedConfigAsync({ model_config_id: asText(params.model_config_id).trim() });
      updatedConfigFields.push("model_config_id");
    }
    if (hasOwn(params, "use_sandbox")) {
      await updatePersistedConfigAsync({
        use_sandbox: parseOptionalBoolean(params.use_sandbox, "use_sandbox") === true,
      });
      updatedConfigFields.push("use_sandbox");
    }

    const after = await readConfigSnapshotAsync();
    // fix: buildStatus is async, must await
    const status = await buildStatus(after);
    const shouldTest = parseOptionalBoolean(params.test_connection, "test_connection") === true;
    const shouldRestart = parseOptionalBoolean(params.restart_service, "restart_service") === true;
    const credentialsChanged = hasOwn(params, "app_id") || hasOwn(params, "app_secret");
    const useSandboxChanged = before.use_sandbox !== after.use_sandbox;
    const credentialsReady = !!(after.app_id && after.app_secret);

    let serviceResult: Record<string, unknown> | null = null;
    if (!credentialsReady) {
      serviceResult = await stopFeishuServiceInternal();
    } else {
      serviceResult = await ensureFeishuServiceStarted(after, {
        restart: shouldRestart || credentialsChanged || useSandboxChanged,
        timeoutMs: DEFAULT_SERVICE_WAIT_MS,
      });
    }

    const result: Record<string, unknown> = {
      success: true,
      updatedConfigFields,
      status,
      service: serviceResult,
    };

    if (shouldTest) {
      const connResult = await feishu_bot_test_connection();
      result.connection = connResult;
      result.success = !!(connResult as Record<string, unknown>).success;
    }
    return result as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_status(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const snapshot = await readConfigSnapshotAsync();
    const summaryOnly = parseOptionalBoolean(params.summary_only, "summary_only") === true;
    // fix: buildStatus is async, must await
    const status = await buildStatus(snapshot);
    return {
      success: true,
      ...status,
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_service_start(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const snapshot = await requireConfiguredSnapshotAsync();
    const result = await ensureFeishuServiceStarted(snapshot, {
      restart: parseOptionalBoolean(params.restart, "restart") === true,
      timeoutMs: parsePositiveInt(params.timeout_ms, "timeout_ms", DEFAULT_SERVICE_WAIT_MS),
    });
    return {
      success: true,
      ...result,
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_service_stop(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const timeoutMs = parsePositiveInt(params.timeout_ms, "timeout_ms", DEFAULT_SERVICE_WAIT_MS);
    const result = await stopFeishuServiceInternal();
    return {
      success: result.success,
      stoppedPids: result.stoppedPids,
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_receive_events(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const autoStart = parseOptionalBoolean(params.auto_start, "auto_start") !== false;
    if (autoStart) {
      const snapshot = await readConfigSnapshotAsync();
      if (snapshot.app_id && snapshot.app_secret) {
        await ensureFeishuServiceStarted(snapshot, {
          timeoutMs: DEFAULT_SERVICE_WAIT_MS,
        });
      }
    }
    const result = await queryQueuedEventsFromService({
      limit: Math.min(
        MAX_RECEIVE_LIMIT,
        parsePositiveInt(params.limit, "limit", DEFAULT_RECEIVE_LIMIT)
      ),
      consume: parseOptionalBoolean(params.consume, "consume") !== false,
      include_raw: parseOptionalBoolean(params.include_raw, "include_raw") === true,
    });
    return {
      success: true,
      ...result,
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_clear_events(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const result = await clearQueuedEventsFromService();
    return {
      success: true,
      ...result,
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_test_connection(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const timeoutMs = resolveTimeoutMs(params.timeout_ms);
    const snapshot = await requireConfiguredSnapshotAsync();
    const token = await fetchTenantAccessToken(
      snapshot.app_id || "",
      snapshot.app_secret || "",
      toBoolean(snapshot.use_sandbox, false)
    );
    const wsEndpoint = await fetchWsEndpoint(
      snapshot.app_id || "",
      snapshot.app_secret || "",
      toBoolean(snapshot.use_sandbox, false)
    );
    // fix: buildStatus is async, must await
    const status = await buildStatus(snapshot);
    const connSuccess = token.code === 0 && !!token.tenant_access_token;
    return {
      success: connSuccess,
      accessTokenType: token.tenant_access_token ? "tenant_access_token" : "",
      accessTokenExpiresIn: token.expire || 0,
      wsEndpoint: wsEndpoint.data?.url || "",
      wsEndpointServiceId: wsEndpoint.data?.service_id || 0,
      status,
      error: token.code !== 0 ? token.msg : (wsEndpoint.code !== 0 ? wsEndpoint.msg : ""),
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

async function feishu_bot_send_text_message(
  params: Record<string, unknown> = {}
): Promise<FeishuActionResult> {
  try {
    const receiveId = asText(params.receive_id).trim();
    if (!receiveId) {
      throw new Error("Missing param: receive_id");
    }
    const content = asText(params.content).trim();
    if (!content) {
      throw new Error("Missing param: content");
    }
    const receiveIdType = asText(params.receive_id_type, "open_id").trim() || "open_id";
    const msgId = asText(params.msg_id).trim();
    const timeoutMs = resolveTimeoutMs(params.timeout_ms);
    const snapshot = await requireConfiguredSnapshotAsync();
    const token = await fetchTenantAccessToken(
      snapshot.app_id || "",
      snapshot.app_secret || "",
      toBoolean(snapshot.use_sandbox, false)
    );
    if (token.code !== 0 || !token.tenant_access_token) {
      throw new Error(`Failed to get tenant_access_token: ${token.msg}`);
    }

    let response;
    if (msgId) {
      response = await replyMessage(
        token.tenant_access_token,
        msgId,
        "text",
        JSON.stringify({ text: content }),
        toBoolean(snapshot.use_sandbox, false)
      );
    } else {
      response = await sendMessage(
        token.tenant_access_token,
        receiveIdType,
        receiveId,
        "text",
        JSON.stringify({ text: content }),
        toBoolean(snapshot.use_sandbox, false)
      );
    }

    return {
      success: response.code === 0,
      messageId: response.data?.message_id || "",
      response: response.data,
      error: response.code !== 0 ? response.msg : "",
    } as FeishuActionResult;
  } catch (error: unknown) {
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

// ==================== 生命周期钩子 ====================

export async function onFeishuListenerApplicationCreate(): Promise<FeishuActionResult> {
  try {
    logFeishuRuntime("listener create hook start");
    const snapshot = await readConfigSnapshotAsync();
    if (!snapshot.app_id || !snapshot.app_secret) {
      logFeishuRuntime("listener create hook skipped: not configured");
      return { success: true, configured: false, started: false };
    }
    const result = await ensureFeishuServiceStarted(snapshot, {
      timeoutMs: DEFAULT_SERVICE_WAIT_MS,
    });
    logFeishuRuntime(`listener create hook completed: started=${result.success}`);
    return {
      success: true,
      configured: true,
      started: result.success,
      result,
    } as FeishuActionResult;
  } catch (error: unknown) {
    console.error(`[feishu_runtime] listener create hook failed: ${safeErrorMessage(error)}`);
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

export async function onFeishuListenerApplicationForeground(): Promise<FeishuActionResult> {
  try {
    logFeishuRuntime("listener foreground hook start");
    const snapshot = await readConfigSnapshotAsync();
    if (!snapshot.app_id || !snapshot.app_secret) {
      logFeishuRuntime("listener foreground hook skipped: not configured");
      return { success: true, configured: false, started: false };
    }
    const result = await ensureFeishuServiceStarted(snapshot, {
      timeoutMs: DEFAULT_SERVICE_WAIT_MS,
    });
    logFeishuRuntime(`listener foreground hook completed: started=${result.success}`);
    return {
      success: true,
      configured: true,
      started: result.success,
      result,
    } as FeishuActionResult;
  } catch (error: unknown) {
    console.error(`[feishu_runtime] listener foreground hook failed: ${safeErrorMessage(error)}`);
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

// ==================== 导出 ====================

export {
  ensureFeishuServiceStarted,
  feishu_bot_configure,
  feishu_bot_status,
  feishu_bot_service_start,
  feishu_bot_service_stop,
  feishu_bot_receive_events,
  feishu_bot_clear_events,
  feishu_bot_test_connection,
  feishu_bot_send_text_message,
};