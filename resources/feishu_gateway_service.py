#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Feishu Gateway Service
======================
飞书双向对话网关服务 —— 接收飞书消息、调用模型、回发。

特性：
  - 长连接接收事件（protobuf 编解码）
  - HTTP 事件队列服务（/health /status /events /events/ack）
  - 自动刷新 tenant_access_token
  - 断线重连 + 心跳保活
  - 通过 --model-api-key/--model-endpoint/--model-name 参数支持可配置化调用

依赖：
  pip install websocket-client
"""

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import signal
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs

try:
    import websocket
except ImportError:
    print("缺少 websocket-client，请执行：pip install websocket-client", file=sys.stderr)
    sys.exit(1)

# ─── DNS 兜底 ─────────────────────────────────────────────────────────────────
# 【稳定性修复·DNS 抖动】Android 上 App 进程内的 DNS 解析（走 netd）在
# 网络切换 / 流量抖动时会出现 `[Errno -3] Temporary failure in name resolution`，
# 而系统 shell 的 ping/nslookup 却是通的 —— 说明是「App 内解析」不稳，不是网络断。
# 这里对飞书长连接域名做兜底：
#   1) 结果缓存（TTL 内不再解析，抖动期直接用缓存 IP，连接不再被解析卡住）
#   2) 显式指定公共 DNS 服务器解析（223.5.5.5 / 119.29.29.29），绕开 netd 抖动
#   3) 全部失败时退回系统默认解析（保证不比原来更差）
# 采用「猴子补丁 socket.getaddrinfo」的方式，对 websocket-client 透明生效。

_DNS_CACHE = {}          # host -> (expire_ts, [(family, type, proto, canonname, sockaddr), ...])
_DNS_CACHE_TTL = 300.0   # 缓存 5 分钟
_DNS_FALLBACK_SERVERS = ["223.5.5.5", "119.29.29.29"]  # 阿里 / 腾讯 公共 DNS

def _resolve_via_dns_server(host, port, dns_server, timeout=3.0):
    """用指定的 DNS 服务器（UDP）解析 host，返回 IPv4 列表。失败返回 []。"""
    import socket as _s
    import struct
    import random
    try:
        # 构造最小 DNS A 记录查询报文
        tid = random.randint(0, 65535)
        header = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
        qname = b"".join(bytes([len(p)]) + p.encode("ascii") for p in host.split(".")) + b"\x00"
        question = qname + struct.pack(">HH", 1, 1)  # QTYPE=A, QCLASS=IN
        packet = header + question

        sock = _s.socket(_s.AF_INET, _s.SOCK_DGRAM)
        sock.settimeout(timeout)
        try:
            sock.sendto(packet, (dns_server, 53))
            data, _ = sock.recvfrom(2048)
        finally:
            sock.close()

        # 解析应答，提取 A 记录（跳过 header + question）
        (rid, flags, qdcount, ancount, _, _) = struct.unpack(">HHHHHH", data[:12])
        if rid != tid or ancount == 0:
            return []
        # 跳过 question 段
        idx = 12
        for _ in range(qdcount):
            while idx < len(data) and data[idx] != 0:
                idx += data[idx] + 1
            idx += 1 + 4  # null + qtype + qclass
        ips = []
        for _ in range(ancount):
            if idx >= len(data):
                break
            # 名称：可能是指针(0xC0)或普通标签
            if data[idx] & 0xC0 == 0xC0:
                idx += 2
            else:
                while idx < len(data) and data[idx] != 0:
                    idx += data[idx] + 1
                idx += 1
            if idx + 10 > len(data):
                break
            rtype, rclass, ttl, rdlen = struct.unpack(">HHIH", data[idx:idx + 10])
            idx += 10
            if rtype == 1 and rdlen == 4:  # A 记录
                ips.append(_s.inet_ntoa(data[idx:idx + 4]))
            idx += rdlen
        return ips
    except Exception:
        return []

def _install_dns_fallback(target_hosts):
    """为指定域名安装 DNS 兜底（缓存 + 显式 DNS 服务器）。"""
    import socket as _s
    original = _s.getaddrinfo

    def _patched(host, port, family=0, type=0, proto=0, flags=0):
        if host not in target_hosts:
            return original(host, port, family, type, proto, flags)
        now = time.time()
        cached = _DNS_CACHE.get(host)
        if cached and cached[0] > now:
            return cached[1]
        # 1) 先用系统默认解析（最快、正常情况下没问题）
        try:
            res = original(host, port, family, type, proto, flags)
            _DNS_CACHE[host] = (now + _DNS_CACHE_TTL, res)
            return res
        except Exception as e:
            log.warning("系统 DNS 解析 %s 失败(%s)，启用公共 DNS 兜底", host, e)
        # 2) 系统解析失败 -> 逐个公共 DNS 服务器尝试
        for server in _DNS_FALLBACK_SERVERS:
            ips = _resolve_via_dns_server(host, port, server)
            if ips:
                log.info("公共 DNS(%s) 解析 %s -> %s", server, host, ips[0])
                res = []
                for ip in ips:
                    res.append((_s.AF_INET, _s.SOCK_STREAM if type in (0, _s.SOCK_STREAM) else type,
                                6 if proto in (0, 6) else proto, "", (ip, port)))
                _DNS_CACHE[host] = (now + _DNS_CACHE_TTL, res)
                return res
        # 3) 全挂 -> 抛出原错误（保持原行为，让上层退避重连）
        log.error("DNS 兜底全部失败: %s", host)
        raise _s.gaierror(-3, "Temporary failure in name resolution (fallback exhausted)")

    _s.getaddrinfo = _patched
    log.info("DNS 兜底已安装，目标域名: %s", ", ".join(sorted(target_hosts)))

# ─── 全局日志 ─────────────────────────────────────────────────────────────────

log = logging.getLogger("feishu_gw")

# ─── 配置常量 ─────────────────────────────────────────────────────────────────

FEISHU_OPEN_BASE_URL = "https://open.feishu.cn"
LOCAL_HTTP_HOST = "127.0.0.1"
LOCAL_HTTP_PORT_DEFAULT = 18790

TOKEN_REFRESH_INTERVAL_SEC = 50 * 60  # 50 分钟

DEFAULT_MODEL_CONFIG = {
    "model_api_key": "",
    "model_endpoint": "https://api.longcat.chat/openai/v1/chat/completions",
    "model_name": "LongCat-2.0",
}


# ─── 网关状态（线程安全）──────────────────────────────────────────────────────

class GatewayState:
    """持有网关的全部可变状态，通过锁保证线程安全。"""

    def __init__(self, app_id, app_secret, model_cfg, service_id, port):
        self.lock = threading.RLock()
        self.app_id = app_id
        self.app_secret = app_secret
        self.service_id = service_id
        self.port = port

        # WS 运行时
        self.ws = None
        self.ws_connected = False
        # 【稳定性修复·发消息无回复】reconnectInterval 默认 90000ms(90s) 过长：
        # WS 一旦断开，最长要等 90 秒才重连，期间飞书服务器推送的事件全部丢失，
        # 表现为「服务在跑但发消息迟迟无回复」。这里改为 3 秒快速重连，
        # 配合 reconnectCount=-1 无限重试，保证断线后几乎无感知恢复。
        # pingInterval 保持 90s（飞书官方推荐心跳间隔，过短易被服务端限流）。
        self.ws_config = {
            "pingInterval": 90000,
            "reconnectCount": -1,
            "reconnectInterval": 3000,
            "reconnectNonce": 25000,
        }

        # 重连控制
        self.reconnect_generation = 0
        self.ping_timer = None

        # 事件队列
        self.events = []
        self.tenant_access_token = None
        self.token_expires_at = 0

        # 【可观测性】长连接侧收包统计：用于判断"飞书到底有没有往这条 WS 推东西"。
        # raw_frames: 收到的所有 WS 帧（含 ping/pong 控制帧）
        # event_frames: 解析为 pbbp2.Frame 且 msg_type == "event" 的业务事件帧
        # last_frame_at / last_event_at: 对应最近一次时间戳（ISO8601）
        self.raw_frames = 0
        self.event_frames = 0
        self.last_frame_at = None
        self.last_event_at = None

        # 事件去重（飞书在未及时收到 ACK 时会重复投递同一事件）
        self.processed_event_ids = {}
        self.processed_event_order = []
        self.max_processed_events = 500

        # 模型配置
        self.model_api_key = model_cfg.get("model_api_key", "")
        self.model_endpoint = model_cfg.get("model_endpoint", DEFAULT_MODEL_CONFIG["model_endpoint"])
        self.model_name = model_cfg.get("model_name", DEFAULT_MODEL_CONFIG["model_name"])

    # ── 线程安全访问器 ──────────────────────────────────────────────────────

    def mark_event_processed(self, event_key):
        """标记事件已处理；若此前已处理过则返回 False（重复事件）。"""
        if not event_key:
            return True
        with self.lock:
            if event_key in self.processed_event_ids:
                return False
            self.processed_event_ids[event_key] = time.time()
            self.processed_event_order.append(event_key)
            # 控制内存：超出上限时淘汰最旧的
            while len(self.processed_event_order) > self.max_processed_events:
                old_key = self.processed_event_order.pop(0)
                self.processed_event_ids.pop(old_key, None)
            return True

    def set_ws(self, ws):
        with self.lock:
            self.ws = ws

    def set_ws_connected(self, connected):
        with self.lock:
            self.ws_connected = connected

    def is_ws_connected(self):
        with self.lock:
            return self.ws_connected

    def update_ws_config(self, data):
        with self.lock:
            for k in ("ws_url", "pingInterval", "reconnectCount", "reconnectInterval", "reconnectNonce"):
                if k in data:
                    self.ws_config[k] = data[k]

    def add_event(self, event):
        with self.lock:
            self.events.append(event)

    def record_frame(self, is_event):
        """【可观测性】记录一次 WS 收帧。is_event=True 表示解析为业务事件帧。"""
        with self.lock:
            now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
            self.raw_frames += 1
            self.last_frame_at = now
            if is_event:
                self.event_frames += 1
                self.last_event_at = now

    def get_events(self):
        with self.lock:
            return list(self.events)

    def clear_events(self):
        with self.lock:
            n = len(self.events)
            self.events.clear()
            return n

    def remove_acknowledged_events(self, count):
        with self.lock:
            if count <= 0:
                return 0
            removed = min(count, len(self.events))
            self.events = self.events[removed:]
            return removed

    def get_status(self):
        with self.lock:
            return {
                "connected": self.ws_connected,
                "service_id": self.service_id,
                "tenant_access_token_exists": self.tenant_access_token is not None,
                "pending_events": len(self.events),
                "ws_config": dict(self.ws_config),
                "model_endpoint": self.model_endpoint,
                "model_name": self.model_name,
                # 【可观测性】长连接收包统计：raw_frames 恒有增长（含心跳）说明 WS 通道活着；
                # event_frames 始终为 0 则说明飞书平台没有推送业务事件（配置侧问题）。
                "raw_frames": self.raw_frames,
                "event_frames": self.event_frames,
                "last_frame_at": self.last_frame_at,
                "last_event_at": self.last_event_at,
            }


# ─── 日志辅助 ─────────────────────────────────────────────────────────────────

def setup_logging(log_file=None):
    log.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    if log_file:
        handler = logging.FileHandler(log_file, encoding="utf-8")
    else:
        handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    log.addHandler(handler)


# ─── HTTP 请求辅助 ─────────────────────────────────────────────────────────────

def http_request(url, data=None, headers=None, method="GET", timeout=15):
    """通用 urllib HTTP 请求。"""
    req = Request(url, data=data, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, body
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        return e.code, body
    except URLError as e:
        raise


# ─── 飞书 OpenAPI ─────────────────────────────────────────────────────────────

def refresh_tenant_access_token(state):
    """从飞书开放平台获取 tenant_access_token。"""
    url = FEISHU_OPEN_BASE_URL + "/open-apis/auth/v3/tenant_access_token/internal"
    payload = json.dumps({
        "app_id": state.app_id,
        "app_secret": state.app_secret,
    }).encode("utf-8")
    try:
        status, body = http_request(
            url,
            data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
            timeout=15,
        )
    except Exception as e:
        log.error("刷新 token 失败: %s", e)
        return False
    if status != 200:
        log.error("刷新 token 返回 %d: %s", status, body[:200])
        return False
    resp = json.loads(body)
    if resp.get("code") != 0:
        log.error("刷新 token 错误 code=%s msg=%s", resp.get("code"), resp.get("msg"))
        return False
    with state.lock:
        state.tenant_access_token = resp["tenant_access_token"]
        # 有效期 2 小时，留 10 分钟缓冲
        state.token_expires_at = time.time() + resp.get("expire", 7200) - 600
    log.info("tenant_access_token 已刷新")
    return True


def get_token(state):
    """获取有效的 token，必要时刷新。"""
    with state.lock:
        if state.tenant_access_token and time.time() < state.token_expires_at:
            return state.tenant_access_token
    # 需要刷新
    if refresh_tenant_access_token(state):
        with state.lock:
            return state.tenant_access_token
    return None


# ─── 模型 API 调用 ────────────────────────────────────────────────────────────

def call_model_api(state, user_message, system_prompt=None):
    """调用模型 API，返回文本或 None。"""
    api_key = state.model_api_key
    endpoint = state.model_endpoint
    model_name = state.model_name

    if not endpoint:
        log.error("model_endpoint 未配置")
        return None

    payload = {
        "model": model_name,
        "messages": [],
        "max_tokens": 2048,
        "temperature": 0.7,
    }
    if system_prompt:
        payload["messages"].append({"role": "system", "content": system_prompt})
    payload["messages"].append({"role": "user", "content": user_message})

    payload_bytes = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        status, body = http_request(
            endpoint,
            data=payload_bytes,
            headers=headers,
            method="POST",
            timeout=60,
        )
    except Exception as e:
        log.error("模型 API 调用失败: %s", e)
        return None
    if status != 200:
        log.error("模型 API 返回 %d: %s", status, body[:300])
        return None
    resp = json.loads(body)
    choices = resp.get("choices", [])
    if choices:
        return choices[0].get("message", {}).get("content", "")
    return None


def send_reply(state, receive_id, content, receive_id_type="open_id"):
    """通过飞书 OpenAPI 发送消息。"""
    token = get_token(state)
    if not token:
        log.error("无法获取 token，无法发送消息")
        return False

    url = FEISHU_OPEN_BASE_URL + f"/open-apis/im/v1/messages?receive_id_type={receive_id_type}"
    payload = json.dumps({
        "receive_id": receive_id,
        "msg_type": "text",
        "content": json.dumps({"text": content}),
    }).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    try:
        status, body = http_request(url, data=payload, headers=headers, method="POST", timeout=15)
    except Exception as e:
        log.error("发送消息失败: %s", e)
        return False
    if status != 200:
        log.error("发送消息返回 %d: %s", status, body[:200])
        return False
    resp = json.loads(body)
    if resp.get("code") != 0:
        log.error("发送消息错误 code=%s msg=%s", resp.get("code"), resp.get("msg"))
        return False
    log.info("消息发送成功 -> %s: %s", receive_id, content[:50])
    return True


# ─── Protobuf 编解码（pbbp2 风格）────────────────────────────────────────────

def encode_varint(value):
    """编码 varint。"""
    out = bytearray()
    if value < 0:
        value = value + (1 << 64)
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def encode_tag(field_number, wire_type):
    """编码 protobuf tag。"""
    return encode_varint((field_number << 3) | wire_type)


def encode_length_delimited(field_number, data):
    """编码 length-delimited 字段。"""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return encode_tag(field_number, 2) + encode_varint(len(data)) + data


def encode_string_field(field_number, value):
    """编码字符串字段。"""
    return encode_length_delimited(field_number, value)


def encode_varint_field(field_number, value):
    """编码 varint 字段。"""
    return encode_tag(field_number, 0) + encode_varint(value)


def encode_int32_field(field_number, value):
    """编码 int32 字段。"""
    return encode_tag(field_number, 0) + encode_varint(value & 0xFFFFFFFF)


def encode_header_entry(key, value):
    """编码单个 pbbp2.Header{key=1,value=2}。"""
    return encode_string_field(1, key) + encode_string_field(2, value)

def encode_frame(seq_id, log_id, service, method, headers, payload=b"",
                 payload_encoding=None, payload_type=None, log_id_new=None):
    """按官方 pbbp2.Frame 定义编码完整 protobuf 消息。"""
    out = bytearray()
    out += encode_varint_field(1, seq_id)      # SeqID
    out += encode_varint_field(2, log_id)      # LogID
    out += encode_int32_field(3, service)      # service
    out += encode_int32_field(4, method)       # method
    for h in headers:
        out += encode_length_delimited(5, encode_header_entry(h["key"], h["value"]))  # headers
    if payload_encoding:
        out += encode_string_field(6, payload_encoding)
    if payload_type:
        out += encode_string_field(7, payload_type)
    if payload:
        out += encode_length_delimited(8, payload)   # payload
    if log_id_new:
        out += encode_string_field(9, log_id_new)
    return bytes(out)

def _skip_field(data, pos, wire_type):
    """跳过未知字段。"""
    if wire_type == 0:
        _, pos = _read_varint(data, pos)
    elif wire_type == 1:
        pos += 8
    elif wire_type == 2:
        ln, pos = _read_varint(data, pos)
        pos += ln
    elif wire_type == 5:
        pos += 4
    else:
        raise ValueError("unsupported wire type %d" % wire_type)
    return pos

def _read_varint(data, pos):
    """读取 varint，返回 (value, new_pos)。"""
    shift = 0
    result = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")
    return result, pos

def decode_frame(data):
    """解码 pbbp2.Frame protobuf，返回 frame dict 或 None。"""
    if not data:
        return None
    frame = {"SeqID": 0, "LogID": 0, "service": 0, "method": 0,
             "headers": [], "payload": b"", "payload_encoding": None,
             "payload_type": None, "LogIDNew": None}
    pos = 0
    n = len(data)
    try:
        while pos < n:
            tag, pos = _read_varint(data, pos)
            field = tag >> 3
            wire = tag & 0x07
            if field == 1:
                frame["SeqID"], pos = _read_varint(data, pos)
            elif field == 2:
                frame["LogID"], pos = _read_varint(data, pos)
            elif field == 3:
                frame["service"], pos = _read_varint(data, pos)
            elif field == 4:
                frame["method"], pos = _read_varint(data, pos)
            elif field == 5:
                ln, pos = _read_varint(data, pos)
                hb = data[pos:pos + ln]; pos += ln
                hp = 0
                hkey, hval = "", ""
                while hp < len(hb):
                    htag, hp = _read_varint(hb, hp)
                    hf = htag >> 3
                    hw = htag & 0x07
                    if hw == 2:
                        hln, hp = _read_varint(hb, hp)
                        hv = hb[hp:hp + hln]; hp += hln
                        if hf == 1:
                            hkey = hv.decode("utf-8", "replace")
                        elif hf == 2:
                            hval = hv.decode("utf-8", "replace")
                    else:
                        hp = _skip_field(hb, hp, hw)
                frame["headers"].append({"key": hkey, "value": hval})
            elif field == 6:
                ln, pos = _read_varint(data, pos)
                frame["payload_encoding"] = data[pos:pos + ln].decode("utf-8", "replace"); pos += ln
            elif field == 7:
                ln, pos = _read_varint(data, pos)
                frame["payload_type"] = data[pos:pos + ln].decode("utf-8", "replace"); pos += ln
            elif field == 8:
                ln, pos = _read_varint(data, pos)
                frame["payload"] = bytes(data[pos:pos + ln]); pos += ln
            elif field == 9:
                ln, pos = _read_varint(data, pos)
                frame["LogIDNew"] = data[pos:pos + ln].decode("utf-8", "replace"); pos += ln
            else:
                pos = _skip_field(data, pos, wire)
    except Exception:
        return None
    return frame

def send_frame(state, headers, payload=b"", method=1, seq_id=0, log_id=0, service=None):
    """通过 WS 发送按官方协议编码的 frame。"""
    with state.lock:
        svc = state.service_id if service is None else service
    try:
        svc_int = int(svc) if str(svc).strip() else 0
    except Exception:
        svc_int = 0
    data = encode_frame(seq_id, log_id, svc_int, method, headers, payload)
    ws = state.ws
    if ws:
        try:
            ws.send(data, opcode=websocket.ABNF.OPCODE_BINARY)
        except Exception as e:
            log.error("WS 发送失败: %s", e)

def send_ping(state):
    """发送 ping 控制帧（method=0 CONTROL, type=ping）。"""
    headers = [{"key": "type", "value": "ping"}]
    send_frame(state, headers, b"", method=0)
    log.debug("ping 已发送")

def start_ping_loop(state):
    """启动周期性 ping。"""
    def loop():
        while state.is_ws_connected():
            time.sleep(state.ws_config["pingInterval"] / 1000.0)
            if not state.is_ws_connected():
                break
            send_ping(state)
    t = threading.Thread(target=loop, daemon=True)
    t.start()


# ─── 事件帧处理 ───────────────────────────────────────────────────────────────

def handle_control_data(state, payload):
    """处理 pong 帧，更新 ws_config。"""
    if not payload:
        return
    try:
        data = json.loads(payload.decode("utf-8"))
    except Exception as e:
        log.error("解析 pong payload 失败: %s", e)
        return
    ws_config = data.get("ws_config", {})
    if ws_config:
        state.update_ws_config(ws_config)
        # 【稳定性修复·发消息无回复】飞书服务端下发的 ws_config 中 pingInterval /
        # reconnectInterval 单位本身就是「毫秒」(官方文档示例：120000 = 120s)。
        # 旧实现误当成「秒」再 ×1000，导致 reconnectInterval 被放大成
        # 1.2 亿毫秒(≈33 小时)，WS 断开后几乎永不重连 —— 这正是「服务在跑但
        # 发消息永久无回复」的最毒根因。此处不再换算，服务端值原样使用；
        # 同时做一次防御性夹紧，避免异常值把重连间隔拉到不可接受的长度。
        for k in ("pingInterval", "reconnectInterval"):
            if k in state.ws_config:
                try:
                    v = float(state.ws_config[k])
                except (TypeError, ValueError):
                    continue
                # 兼容极少数仍以「秒」下发的旧格式：小于 1000 视为秒，×1000
                if 0 < v < 1000:
                    v = v * 1000
                # 夹紧到合理区间，reconnectInterval 上限 30s，pingInterval 上限 300s
                if k == "reconnectInterval":
                    v = max(1000.0, min(v, 30000.0))
                else:
                    v = max(1000.0, min(v, 300000.0))
                state.ws_config[k] = v
        log.info("ws_config 已更新: %s", state.ws_config)


def handle_event_data(state, payload):
    """处理业务事件帧。"""
    if not payload:
        return
    try:
        data = json.loads(payload.decode("utf-8"))
    except Exception as e:
        log.error("解析事件 payload 失败: %s", e)
        return
    header = data.get("header", {})
    event_type = header.get("event_type", "")
    if event_type != "im.message.receive_v1":
        log.debug("忽略事件类型: %s", event_type)
        return
    # 去重：飞书未及时收到 ACK 时会重投同一事件，此处拦截避免重复回复
    event_id = header.get("event_id", "") or ""
    message_id_for_dedup = (data.get("event", {}).get("message", {}) or {}).get("message_id", "") or ""
    dedup_key = event_id or message_id_for_dedup
    if not state.mark_event_processed(dedup_key):
        log.info("[Dedup] 重复事件已忽略 event_id=%s message_id=%s", event_id, message_id_for_dedup)
        return
    event = data.get("event", {})
    message = event.get("message", {})
    message_type = message.get("message_type", "")
    chat_type = message.get("chat_type", "")
    if chat_type != "p2p":
        log.debug("忽略非私聊事件 chat_type=%s", chat_type)
        return

    # 提取文本
    content = message.get("content", "")
    text = ""
    try:
        content_obj = json.loads(content)
        text = content_obj.get("text", "").strip()
    except Exception:
        text = content.strip()

    if not text:
        log.debug("忽略空消息")
        return

    # 兼容：sender 在 event 层级（官方结构），部分版本可能在 message 层级
    sender = event.get("sender") or message.get("sender") or {}
    sid = sender.get("sender_id") or sender.get("id") or {}
    open_id = sid.get("open_id") or sid.get("union_id") or sid.get("user_id") or ""
    log.info("[Msg] Text: %s from %s", text, open_id)
    if not open_id:
        log.error("[Msg] open_id 为空，sender 原始结构: %s", json.dumps(sender, ensure_ascii=False))

    # 调用模型
    system_prompt = "你是一个友善、有帮助的 AI 助手。请用简洁、清晰的语言回答用户的问题。"
    reply_text = call_model_api(state, text, system_prompt)
    if reply_text:
        log.info("[Reply] %s", reply_text[:80])
        send_reply(state, open_id, reply_text)
    else:
        log.error("模型调用失败")


def _process_event_async(state, payload, msg_id, t0):
    """后台线程：处理事件（可能调用慢模型），完成后补发带真实 biz_rt 的 ACK。

    拆到独立线程是为了让 WS 收帧回调尽快返回——首帧 ACK 已在回调里
    同步发出，这里只负责业务处理 + 完成 ACK，不阻塞 ws 收帧线程。
    """
    try:
        handle_event_data(state, payload)
    except Exception as e:
        log.error("[ACK-DIAG] 事件处理异常: %s", e)
    finally:
        biz_rt = int((time.time() - t0) * 1000)
        done_headers = [
            {"key": "type", "value": "event"},
            {"key": "message_id", "value": msg_id},
            {"key": "biz_rt", "value": str(biz_rt)},
        ]
        send_frame(state, done_headers, b'{"code": 200}')
        log.info("[ACK-DIAG] 已发送完成 ACK biz_rt=%d message_id=%r", biz_rt, msg_id)


# ─── WS 回调 ──────────────────────────────────────────────────────────────────

def on_ws_message(ws, message):
    """WS 收到消息，按官方 pbbp2.Frame 解析。"""
    state = ws.gateway_state
    if isinstance(message, str):
        message = message.encode("utf-8")
    if not isinstance(message, (bytes, bytearray)):
        return
    frame = decode_frame(bytes(message))
    if frame is None:
        log.error("解码 frame 失败")
        return
    method = frame.get("method", 0)
    headers = frame.get("headers", [])
    payload = frame.get("payload", b"") or b""
    hmap = {}
    for h in headers:
        hmap[h["key"]] = h["value"]
    msg_type = hmap.get("type", "")
    # 【可观测性】先记录收帧，再判断类型。
    # 这样即使后续逻辑因任何原因提前 return，也能在 /status 看到"飞书确实推了东西"。
    state.record_frame(is_event=(method != 0 and msg_type == "event"))
    if method == 0:
        # CONTROL 帧：ping / pong
        if msg_type == "pong":
            handle_control_data(state, payload)
        else:
            log.debug("CONTROL frame type=%s", msg_type)
    else:
        # DATA 帧：event / card
        if msg_type == "event":
            # 先回 ACK，再处理事件（处理会调用模型，耗时较长，
            # 若等处理完再 ACK，期间连接抖动会导致飞书重投同一事件）
            msg_id = hmap.get("message_id", "")
            # [诊断] 打印事件帧完整 header，确认 message_id 是否可取到
            try:
                hdr_dump = {h["key"]: h["value"] for h in headers}
                log.info("[ACK-DIAG] event frame headers=%s frame.SeqID=%s frame.LogID=%s",
                         json.dumps(hdr_dump, ensure_ascii=False),
                         frame.get("SeqID"), frame.get("LogID"))
            except Exception as _e:
                log.warning("[ACK-DIAG] dump headers 失败: %s", _e)
            # 【重投消除】首帧 ACK 的 biz_rt 不能为 0——实测飞书对
            # biz_rt=0 的 ACK 判定为"处理尚未开始"，约 20 秒后重投同一事件。
            # 这里给一个非零的最小值（1ms，象征"已开始处理"），
            # 完成 ACK 仍会带真实耗时，兼容两种判定逻辑。
            ack_headers = [
                {"key": "type", "value": "event"},
                {"key": "message_id", "value": msg_id},
                {"key": "biz_rt", "value": "1"},
            ]
            send_frame(state, ack_headers, b'{"code": 200}')
            log.info("[ACK-DIAG] 已发送首次 ACK (biz_rt=1) message_id=%r", msg_id)
            # 【异步解耦】立即返回，不阻塞 WS 收帧线程。
            # 模型调用（可能 10+ 秒）放到后台线程执行，完成后补发带真实
            # biz_rt 的 ACK。这样首帧 ACK 能在毫秒级送出，
            # 且 WS 线程不会被慢模型阻塞（避免 ping/其它帧被延迟）。
            _t0 = time.time()
            threading.Thread(
                target=_process_event_async,
                args=(state, payload, msg_id, _t0),
                daemon=True,
            ).start()
        else:
            log.debug("DATA frame type=%s", msg_type)

def on_ws_error(ws, error):
    """WS 错误。"""
    state = ws.gateway_state
    log.error("WS 错误: %s", error)
    state.set_ws_connected(False)


def on_ws_close(ws, close_status_code, close_msg):
    """WS 关闭。"""
    state = ws.gateway_state
    log.warning("WS 关闭: %s %s", close_status_code, close_msg)
    state.set_ws_connected(False)
    # 启动重连（指数退避）
    # 【稳定性修复·DNS 抖动】旧逻辑固定 3 秒重连：DNS 抖动时会在几秒内疯狂
    # 空转重试，既刷爆日志、又让飞书服务端看到连接反复建立/断开，事件被排队。
    # 改为指数退避 3s→6s→12s→24s→30s 封顶，连接成功一次即重置。
    base_delay = state.ws_config.get("reconnectInterval", 3000) / 1000.0
    state.reconnect_generation += 1
    gen = state.reconnect_generation
    # 用「连续失败次数」计算退避：第一次失败退 base，之后按 2 的幂增长
    fails = max(0, gen - 1)
    delay = min(base_delay * (2 ** fails), 30.0)
    log.info("%.1f 秒后重连 (#%d)", delay, gen)
    time.sleep(delay)
    _connect(state)


def on_ws_open(ws):
    """WS 连接建立。"""
    state = ws.gateway_state
    log.info("WS 已连接")
    state.set_ws_connected(True)
    # 【稳定性修复·DNS 抖动】连接成功即重置退避计数，避免下次偶发断线
    # 直接继承上一次的长退避（否则一次网络抖动会让后续重连永远等 30s）。
    if state.reconnect_generation != 0:
        log.info("连接恢复，重置重连退避计数 (was #%d)", state.reconnect_generation)
        state.reconnect_generation = 0
    # 立即发一次 ping
    send_ping(state)
    # 启动周期 ping
    start_ping_loop(state)


# ─── WS 连接 ──────────────────────────────────────────────────────────────────

def _connect(state):
    """建立 WS 连接。"""
    ws_url = state.ws_config.get("ws_url", "")
    if not ws_url:
        log.error("ws_url 未配置，无法连接")
        return
    ws = websocket.WebSocketApp(
        ws_url,
        on_message=on_ws_message,
        on_error=on_ws_error,
        on_close=on_ws_close,
        on_open=on_ws_open,
    )
    ws.gateway_state = state
    state.set_ws(ws)
    log.info("正在连接 WS: %s", ws_url)
    ws.run_forever()


# ─── HTTP 事件队列服务 ────────────────────────────────────────────────────────

class EventHandler(BaseHTTPRequestHandler):
    """本地 HTTP 服务器处理事件队列。"""

    def log_message(self, format, *args):
        """覆盖默认日志。"""
        log.debug("HTTP %s - %s", self.address_string(), format % args)

    def _send_json(self, code, obj):
        """发送 JSON 响应。"""
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        """处理 GET 请求。"""
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/health":
            connected = self.server.gateway_state.is_ws_connected()
            status = "ok" if connected else "degraded"
            self._send_json(200, {"status": status})
        elif path == "/status":
            self._send_json(200, self.server.gateway_state.get_status())
        elif path == "/events":
            events = self.server.gateway_state.get_events()
            self._send_json(200, {"events": events, "count": len(events)})
        else:
            self._send_json(404, {"error": "not found"})

    def do_DELETE(self):
        """处理 DELETE 请求。"""
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/events":
            n = self.server.gateway_state.clear_events()
            self._send_json(200, {"cleared": n})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        """处理 POST 请求。"""
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/events/ack":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                data = {}
            count = data.get("count", 0)
            acked = self.server.gateway_state.remove_acknowledged_events(count)
            self._send_json(200, {"acked": acked})
        else:
            self._send_json(404, {"error": "not found"})


def start_http_server(state):
    """启动本地 HTTP 事件队列服务。"""
    server = HTTPServer((LOCAL_HTTP_HOST, state.port), EventHandler)
    server.gateway_state = state
    log.info("HTTP 服务启动于 http://%s:%d", LOCAL_HTTP_HOST, state.port)
    server.serve_forever()


# ─── Token 刷新定时器 ──────────────────────────────────────────────────────────

def start_token_refresh_timer(state):
    """定时刷新 token。"""
    def loop():
        while True:
            time.sleep(60)  # 每分钟检查一次
            with state.lock:
                need_refresh = time.time() >= state.token_expires_at - 600
            if need_refresh:
                refresh_tenant_access_token(state)
    t = threading.Thread(target=loop, daemon=True)
    t.start()


# ─── 参数解析 ─────────────────────────────────────────────────────────────────

def _kill_stale_instances():
    """启动前清理同脚本的旧进程，避免多进程互相顶号。"""
    try:
        me = os.getpid()
        script_name = os.path.basename(os.path.abspath(__file__))
        for entry in os.listdir('/proc'):
            if not entry.isdigit():
                continue
            pid = int(entry)
            if pid == me:
                continue
            try:
                raw = open('/proc/%d/cmdline' % pid, 'rb').read()
            except Exception:
                continue
            cmd = raw.decode('utf-8', 'replace').replace(chr(0), ' ')
            if script_name not in cmd:
                continue
            if 'python' not in cmd:
                continue
            try:
                os.kill(pid, signal.SIGKILL)
                sys.stderr.write('[cleanup] killed stale gateway pid=%d' % pid)
            except Exception:
                pass
    except Exception:
        pass

def parse_args(argv=None):
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="Feishu Gateway Service")
    parser.add_argument("--port", type=int, default=LOCAL_HTTP_PORT_DEFAULT, help="本地 HTTP 端口")
    parser.add_argument("--ws-url", required=True, help="飞书长连接 URL")
    parser.add_argument("--token", required=True, help="飞书长连接 token")
    parser.add_argument("--app-id", required=True, help="飞书应用 AppID")
    parser.add_argument("--app-secret", required=True, help="飞书应用 AppSecret")
    parser.add_argument("--model-api-key", default="", help="模型 API Key")
    parser.add_argument("--model-endpoint", default=DEFAULT_MODEL_CONFIG["model_endpoint"], help="模型 API 端点")
    parser.add_argument("--model-name", default=DEFAULT_MODEL_CONFIG["model_name"], help="模型名称")
    parser.add_argument("--log-file", default=None, help="日志文件路径")
    return parser.parse_args(argv)


def main():
    """主入口。"""
    args = parse_args()
    setup_logging(args.log_file)
    _kill_stale_instances()

    # 【稳定性修复·DNS 抖动】在建立任何网络连接之前安装 DNS 兜底。
    # 从 ws_url 中提取主机名，确保长连接域名走「缓存 + 公共 DNS 兜底」。
    _dns_targets = {"msg-frontier.feishu.cn", "open.feishu.cn"}
    try:
        _dns_host = urlparse(args.ws_url).hostname
        if _dns_host:
            _dns_targets.add(_dns_host)
    except Exception as _e:
        log.warning("解析 ws_url 主机名失败: %s", _e)
    _install_dns_fallback(_dns_targets)

    log.info("飞书网关服务启动")

    # 构建模型配置
    model_cfg = {
        "model_api_key": args.model_api_key,
        "model_endpoint": args.model_endpoint,
        "model_name": args.model_name,
    }

    # 从 ws-url 提取 service_id
    ws_url = args.ws_url
    service_id = ""
    if "service_id=" in ws_url:
        parsed = urlparse(ws_url)
        qs = parse_qs(parsed.query)
        service_id = qs.get("service_id", [""])[0]

    # 初始化状态
    state = GatewayState(
        app_id=args.app_id,
        app_secret=args.app_secret,
        model_cfg=model_cfg,
        service_id=service_id,
        port=args.port,
    )

    # 先刷新一次 token
# 初始化 token...
    log.info("初始化 token...")
    state.ws_config["ws_url"] = args.ws_url
    state.update_ws_config({"ws_url": args.ws_url})
    if not refresh_tenant_access_token(state):
        log.error("初始 token 刷新失败")
        sys.exit(1)

    # 启动 HTTP 服务（后台线程）
    http_thread = threading.Thread(target=start_http_server, args=(state,), daemon=True)
    http_thread.start()

    # 启动 token 刷新定时器
    start_token_refresh_timer(state)

    # 保存 PID 文件
    pid = os.getpid()
    pid_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feishu_gateway.pid")
    try:
        with open(pid_file, "w") as f:
            f.write(str(pid))
        log.info("PID 文件: %s (%d)", pid_file, pid)
    except Exception as e:
        log.warning("写入 PID 文件失败: %s", e)

    # 建立 WS 连接（阻塞）
    log.info("建立飞书长连接...")
    _connect(state)


if __name__ == "__main__":
    main()
