/**
 * Runtime facts for the Operit sandbox (quickjs), VERIFIED BY LIVE PROBING.
 *
 * These are notes only. We deliberately declare NOTHING here, because the
 * official type library at `dev_package/types/*.d.ts` already declares the
 * real globals (`Tools`, `ToolPkg`, `toolCall`, ...). Re-declaring them here
 * would cause "Cannot redeclare block-scoped variable" errors under tsc.
 *
 * ---------------------------------------------------------------------------
 * FACT 1 — `fetch` DOES NOT EXIST.
 *   Calling `fetch(...)` throws: ReferenceError: 'fetch' is not defined.
 *   `XMLHttpRequest` DOES NOT EXIST either.
 *   -> Use `Tools.Net.httpGet/httpPost/http` (returns Promise<HttpResponseData>).
 *   -> This project funnels every request through `fetchCompat()` in
 *      `feishu_common.ts`, a drop-in fetch-shaped adapter.
 *
 * FACT 2 — `getPluginConfigDir` DOES NOT EXIST AT RUNTIME.
 *   The official `types/index.d.ts` declares it (line ~278), which let `tsc`
 *   pass while the code crashed at runtime. The real, working API is:
 *       ToolPkg.getConfigDir(pluginId: string): string
 *   -> `feishu_state.ts` uses ToolPkg.getConfigDir(FEISHU_TOOLPKG_ID).
 *
 * FACT 3 — `Tools.Net.http` response contract (HttpResponseData):
 *   { __type, url, statusCode, statusMessage, headers, contentType,
 *     content, contentBase64, size }
 *   - `statusCode` replaces fetch's `response.status`.
 *   - `content` (string) replaces `await response.text()`. There is NO `body`.
 *   - Non-2xx does NOT throw; network errors DO throw -> always try/catch.
 * ---------------------------------------------------------------------------
 */

export {};
