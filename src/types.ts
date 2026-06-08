/** 钉钉 AI 助理回调请求体 */
export interface CollectMessageRequest {
  senderNickName?: string;
  senderUserId?: string;
  senderUnionId?: string;
  senderCorpId?: string;
  senderStaffId?: string;
  msgContent?: string;
  messageAttribute?: string;
  conversationId?: string;
  sessionWebhook?: string;
  conversationTitle?: string;
}

/** 数据库中的消息记录 */
export interface ChatMessageRow {
  conversationId: string;
  conversationTitle: string;
  senderNick: string;
  senderStaffId: string;
  senderUserId: string;
  msgType: string;
  msgContent: string;
  msgText: string;
  messageAttribute: string;
  receivedAt: string;
}

/** 查询参数 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  staffId?: string;
  startTime?: string;
  endTime?: string;
}
