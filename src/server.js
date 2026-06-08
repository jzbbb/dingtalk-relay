const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 80;
const RELAY_SECRET = process.env.RELAY_SECRET || "";

const app = express();
app.use(express.json());

const server = http.createServer(app);

// ============================================================
// WebSocket Server —— 内网客户端通过此连接订阅消息
// ============================================================

const wss = new WebSocketServer({ server, path: "/ws" });
const subscribers = new Set();

wss.on("connection", (ws, req) => {
  // 简单鉴权：通过 query 参数传递 secret
  const url = new URL(req.url, `http://${req.headers.host}`);
  const secret = url.searchParams.get("secret");

  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    ws.close(4001, "Unauthorized");
    console.log("[WS] 客户端鉴权失败，已拒绝");
    return;
  }

  subscribers.add(ws);
  console.log(`[WS] 内网客户端已连接 (当前 ${subscribers.size} 个)`);

  ws.on("close", () => {
    subscribers.delete(ws);
    console.log(`[WS] 内网客户端断开 (剩余 ${subscribers.size} 个)`);
  });

  ws.on("error", (err) => {
    console.error("[WS] 连接错误:", err.message);
    subscribers.delete(ws);
  });

  // 发送欢迎消息
  ws.send(JSON.stringify({ type: "connected", message: "中转服务已连接" }));
});

/**
 * 向所有已连接的内网客户端广播消息
 */
function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const ws of subscribers) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

// ============================================================
// HTTP 路由 —— 接收钉钉 AI 助理回调
// ============================================================

app.post("/api/v1/actions/dingtalk/collect_chat_message", (req, res) => {
  const data = req.body || {};

  const senderNick = data.senderNickName || "unknown";
  const conversationId = data.conversationId || "";
  const msgContent = data.msgContent || "";

  console.log(`[收到消息] ${senderNick} @ ${conversationId}: ${msgContent.slice(0, 100)}`);

  // 广播给所有内网订阅者
  broadcast({
    type: "dingtalk_message",
    payload: data,
    receivedAt: new Date().toISOString(),
  });

  // 返回钉钉要求的格式
  res.json({ collected: "true" });
});

app.get("/api/v1/actions/dingtalk/health", (_req, res) => {
  res.json({
    status: "running",
    subscribers: subscribers.size,
    time: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.json({
    service: "dingtalk-relay",
    subscribers: subscribers.size,
    endpoints: {
      callback: "POST /api/v1/actions/dingtalk/collect_chat_message",
      health: "GET /api/v1/actions/dingtalk/health",
      websocket: "WS /ws?secret=xxx",
    },
  });
});

// ============================================================
// 启动
// ============================================================

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 中转服务启动: http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket 路径: ws://0.0.0.0:${PORT}/ws`);
  console.log(`🔑 鉴权: ${RELAY_SECRET ? "已启用" : "未启用（建议设置 RELAY_SECRET）"}`);
});
