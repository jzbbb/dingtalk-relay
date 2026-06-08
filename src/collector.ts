import { insertMessage } from "./db";
import { processRichTextImages } from "./oss";
import type { CollectMessageRequest, ChatMessageRow } from "./types";

function parseMsgType(messageAttribute?: string): string {
  if (!messageAttribute) return "unknown";
  try {
    const attr = JSON.parse(messageAttribute);
    return attr.msgType || "unknown";
  } catch {
    return "unknown";
  }
}

function buildReadableText(msgContent: string, msgType: string): string {
  if (!msgContent) return "";

  try {
    const parsed = JSON.parse(msgContent);

    if (msgType === "richText" && Array.isArray(parsed.richText)) {
      const parts: string[] = [];
      for (const item of parsed.richText) {
        if (item.text) {
          parts.push(item.text);
        } else if (item.ossUrl) {
          parts.push(`[图片: ${item.ossUrl}]`);
        } else if (item.downLoadUrl) {
          parts.push(`[图片: ${item.downLoadUrl}]`);
        }
      }
      return parts.join("").trim();
    }

    if (msgType === "text") {
      return parsed.text || parsed.content || "";
    }

    if (parsed.text) return parsed.text;
    if (parsed.content) return parsed.content;
  } catch {
    // 不是 JSON，原样返回
  }

  return msgContent;
}

export async function handleMessage(data: CollectMessageRequest): Promise<void> {
  let msgType = parseMsgType(data.messageAttribute);
  const conversationId = data.conversationId || "unknown";
  let msgContent = data.msgContent || "";

  // 从 msgContent JSON 内部检测真实类型
  try {
    const parsed = JSON.parse(msgContent);
    if (parsed.msgType && parsed.msgType !== msgType) {
      msgType = parsed.msgType;
    }
  } catch {
    /* 非 JSON，忽略 */
  }

  // richText 类型：图片上传 OSS
  if (msgType === "richText" && msgContent) {
    msgContent = await processRichTextImages(msgContent, conversationId);
  }

  const msgText = buildReadableText(msgContent, msgType);

  const row: ChatMessageRow = {
    conversationId,
    conversationTitle: data.conversationTitle || "",
    senderNick: data.senderNickName || "",
    senderStaffId: data.senderStaffId || "",
    senderUserId: data.senderUserId || "",
    msgType,
    msgContent,
    msgText,
    messageAttribute: data.messageAttribute || "",
    receivedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  await insertMessage(row);

  console.log(
    `[Collector] 已入库 | 群=${row.conversationTitle || row.conversationId} | 发送人=${row.senderNick}(${row.senderStaffId}) | 类型=${msgType}`,
  );
}
