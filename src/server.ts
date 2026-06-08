import "dotenv/config";

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { initDatabase, queryMessages, listConversations } from "./db";
import { handleMessage } from "./collector";
import type { CollectMessageRequest } from "./types";

const PORT = Number(process.env.PORT) || 80;
const RELAY_SECRET = process.env.RELAY_SECRET || "";

const app = express();
app.use(express.json());

const server = http.createServer(app);

// ============================================================
// WebSocket Server —— 内网客户端可选订阅实时消息
// ============================================================

const wss = new WebSocketServer({ server, path: "/ws" });
const subscribers = new Set<WebSocket>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const secret = url.searchParams.get("secret");

  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    ws.close(4001, "Unauthorized");
    console.log("[WS] 客户端鉴权失败，已拒绝");
    return;
  }

  subscribers.add(ws);
  console.log(`[WS] 客户端已连接 (当前 ${subscribers.size} 个)`);

  ws.on("close", () => {
    subscribers.delete(ws);
    console.log(`[WS] 客户端断开 (剩余 ${subscribers.size} 个)`);
  });

  ws.on("error", (err) => {
    console.error("[WS] 连接错误:", err.message);
    subscribers.delete(ws);
  });

  ws.send(JSON.stringify({ type: "connected", message: "已连接消息收集服务" }));
});

function broadcast(data: Record<string, unknown>): void {
  const payload = JSON.stringify(data);
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// ============================================================
// 钉钉回调 —— 接收消息 → 存储 MySQL → 广播 WebSocket
// ============================================================

app.post("/api/v1/actions/dingtalk/collect_chat_message", (req, res) => {
  const data = req.body as CollectMessageRequest;
  const senderNick = data.senderNickName || "unknown";
  const msgContent = data.msgContent || "";

  console.log(`[收到消息] ${senderNick}: ${msgContent.slice(0, 100)}`);
  console.log(`[DEBUG 完整请求体] ${JSON.stringify(req.body).slice(0, 2000)}`);

  handleMessage(data).catch((err: Error) => {
    console.error(`[Collector] 处理失败: ${err.message}`);
  });

  broadcast({
    type: "dingtalk_message",
    payload: data,
    receivedAt: new Date().toISOString(),
  });

  res.json({ collected: "true" });
});

// ============================================================
// 查询 API —— 内网服务器通过 HTTP 查询聊天记录
// ============================================================

app.get("/api/messages", async (req, res) => {
  try {
    const { conversationId, limit, offset, staffId, startTime, endTime } = req.query;

    if (!conversationId || typeof conversationId !== "string") {
      res.status(400).json({ error: "缺少 conversationId 参数" });
      return;
    }

    const rows = await queryMessages(conversationId, {
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      staffId: staffId as string | undefined,
      startTime: startTime as string | undefined,
      endTime: endTime as string | undefined,
    });

    res.json({ total: rows.length, messages: rows });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[查询失败]", errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

app.get("/api/conversations", async (_req, res) => {
  try {
    const conversations = await listConversations();
    res.json({ total: conversations.length, conversations });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[查询群列表失败]", errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================
// 健康检查 & 首页
// ============================================================

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
    version: "2.0.0",
    subscribers: subscribers.size,
    endpoints: {
      callback: "POST /api/v1/actions/dingtalk/collect_chat_message",
      health: "GET /api/v1/actions/dingtalk/health",
      messages: "GET /api/messages?conversationId=xxx&limit=50",
      conversations: "GET /api/conversations",
      websocket: "WS /ws?secret=xxx",
    },
  });
});

// ============================================================
// 启动
// ============================================================

async function start(): Promise<void> {
  await initDatabase();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 消息收集服务启动: http://0.0.0.0:${PORT}`);
    console.log(`📡 WebSocket: ws://0.0.0.0:${PORT}/ws`);
    console.log(`🔑 鉴权: ${RELAY_SECRET ? "已启用" : "未启用"}`);
  });
}

start().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
