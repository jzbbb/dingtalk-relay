import { insertMessage } from "./db";
import { processRichTextImages, processPictureImage } from "./oss";
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

  // 优先使用 originMsgContent（包含完整富文本 + 图片链接）
  if (data.originMsgContent) {
    try {
      const origin = JSON.parse(data.originMsgContent);
      if (origin.msgType) {
        msgType = origin.msgType;
      }
      // richText 类型：提取 richText 数组
      if (origin.richText || origin.msgType === "richText") {
        msgContent = JSON.stringify({ richText: origin.richText });
      }
      // picture 类型：提取图片 URL 构造 JSON
      if (origin.msgType === "picture" && origin.picture) {
        msgContent = JSON.stringify({ pictureUrl: origin.picture, mediaId: origin.mediaId });
      }
    } catch {
      /* 解析失败，继续用原始 msgContent */
    }
  } else {
    // 从 msgContent JSON 内部检测真实类型
    try {
      const parsed = JSON.parse(msgContent);
      if (parsed.msgType && parsed.msgType !== msgType) {
        msgType = parsed.msgType;
      }
    } catch {
      /* 非 JSON，忽略 */
    }
  }

  console.log(`[Collector] 消息类型=${msgType} | msgContent=${msgContent.slice(0, 300)}`);

  // richText 类型：图片上传 OSS
  if (msgType === "richText" && msgContent) {
    msgContent = await processRichTextImages(msgContent, conversationId);
  }

  // picture 类型：单张图片上传 OSS
  if (msgType === "picture" && msgContent) {
    msgContent = await processPictureImage(msgContent, conversationId);
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
