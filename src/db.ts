import * as mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ChatMessageRow, QueryOptions } from "./types";

let pool: Pool | null = null;
const createdTables = new Set<string>();

function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "qbi_collector",
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
    });
  }
  return pool;
}

function toTableName(conversationId: string): string {
  return `msg_${conversationId}`;
}

function escapeComment(text: string): string {
  return text.replace(/[\\'"\0\n\r\x1a]/g, "").slice(0, 60);
}

export async function initDatabase(): Promise<void> {
  const database = (process.env.MYSQL_DATABASE || "qbi_collector").replace(/[^a-zA-Z0-9_]/g, "");

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
  });
  await conn.execute(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();

  await getPool().execute("SELECT 1");
  console.log("[DB] 数据库初始化完成");
}

async function ensureTable(conversationId: string, conversationTitle: string): Promise<string> {
  const tableName = toTableName(conversationId);
  if (createdTables.has(tableName)) return tableName;

  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      conversation_title VARCHAR(255) DEFAULT '' COMMENT '群名称',
      sender_nick VARCHAR(128) DEFAULT '' COMMENT '发送人昵称',
      sender_staff_id VARCHAR(64) DEFAULT '' COMMENT '发送人工号',
      sender_user_id VARCHAR(128) DEFAULT '' COMMENT '发送人UserId',
      msg_type VARCHAR(32) DEFAULT 'text' COMMENT '消息类型',
      msg_content TEXT COMMENT '原始消息内容(JSON)',
      msg_text TEXT COMMENT '可读纯文本',
      received_at DATETIME NOT NULL COMMENT '接收时间',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '入库时间',
      INDEX idx_received_at (received_at),
      INDEX idx_sender_staff_id (sender_staff_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='${escapeComment(conversationTitle)}'
  `);

  createdTables.add(tableName);
  console.log(`[DB] 建表完成: ${tableName} (${conversationTitle})`);
  return tableName;
}

export async function insertMessage(row: ChatMessageRow): Promise<void> {
  const tableName = await ensureTable(row.conversationId, row.conversationTitle);

  await getPool().execute(
    `INSERT INTO \`${tableName}\`
      (conversation_title, sender_nick, sender_staff_id,
       sender_user_id, msg_type, msg_content, msg_text, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.conversationTitle,
      row.senderNick,
      row.senderStaffId,
      row.senderUserId,
      row.msgType,
      row.msgContent,
      row.msgText,
      row.receivedAt,
    ],
  );
}

export async function queryMessages(
  conversationId: string,
  options: QueryOptions = {},
): Promise<RowDataPacket[]> {
  const { limit = 50, offset = 0, staffId, startTime, endTime } = options;
  const tableName = toTableName(conversationId);
  const database = (process.env.MYSQL_DATABASE || "qbi_collector").replace(/[^a-zA-Z0-9_]/g, "");

  const [tables] = await getPool().execute<RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    [database, tableName],
  );
  if (tables.length === 0) return [];

  let sql = `SELECT * FROM \`${tableName}\` WHERE 1=1`;
  const params: string[] = [];

  if (staffId) {
    sql += " AND sender_staff_id = ?";
    params.push(staffId);
  }
  if (startTime) {
    sql += " AND received_at >= ?";
    params.push(startTime);
  }
  if (endTime) {
    sql += " AND received_at <= ?";
    params.push(endTime);
  }

  sql += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
  params.push(String(limit), String(offset));

  const [rows] = await getPool().execute<RowDataPacket[]>(sql, params);
  return rows;
}

export async function listConversations(): Promise<{ tableName: string; conversationTitle: string }[]> {
  const database = (process.env.MYSQL_DATABASE || "qbi_collector").replace(/[^a-zA-Z0-9_]/g, "");

  const [tables] = await getPool().execute<RowDataPacket[]>(
    "SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'msg_%'",
    [database],
  );

  return tables.map((t) => ({
    tableName: t.TABLE_NAME as string,
    conversationTitle: t.TABLE_COMMENT as string,
  }));
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
