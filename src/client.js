/**
 * 内网客户端 —— 连接 ECS 中转服务，接收钉钉消息并转发到本地 msg_collector
 *
 * 用法:
 *   RELAY_URL=ws://47.99.147.30/ws node src/client.js
 */

const WebSocket = require("ws");
const http = require("http");

const RELAY_URL = process.env.RELAY_URL || "ws://47.99.147.30/ws";
const RELAY_SECRET = process.env.RELAY_SECRET || "";
const LOCAL_TARGET = process.env.LOCAL_TARGET || "http://127.0.0.1:5050/api/v1/actions/dingtalk/collect_chat_message";

const RECONNECT_INTERVAL_MS = 3000;

/**
 * 将钉钉消息转发到本地 msg_collector
 */
function forwardToLocal(payload) {
  const url = new URL(LOCAL_TARGET);
  const body = JSON.stringify(payload);

  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 30000,
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * 建立 WebSocket 连接，断线自动重连
 */
function connect() {
  const wsUrl = RELAY_SECRET
    ? `${RELAY_URL}?secret=${encodeURIComponent(RELAY_SECRET)}`
    : RELAY_URL;

  console.log(`[连接] ${RELAY_URL} ...`);
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[已连接] 中转服务连接成功 ✅");
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error("[解析失败]", raw.toString().slice(0, 200));
      return;
    }

    if (msg.type === "connected") {
      console.log(`[服务端] ${msg.message}`);
      return;
    }

    if (msg.type === "dingtalk_message") {
      const sender = msg.payload?.senderNickName || "unknown";
      console.log(`[收到消息] ${sender}: ${(msg.payload?.msgContent || "").slice(0, 100)}`);

      try {
        const result = await forwardToLocal(msg.payload);
        console.log(`[已转发] → 本地 msg_collector (${result.status})`);
      } catch (err) {
        console.error(`[转发失败] ${err.message}`);
      }
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[断开] code=${code} reason=${reason || "无"} → ${RECONNECT_INTERVAL_MS / 1000}s 后重连`);
    setTimeout(connect, RECONNECT_INTERVAL_MS);
  });

  ws.on("error", (err) => {
    console.error(`[错误] ${err.message}`);
  });
}

connect();
