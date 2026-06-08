// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require("ali-oss");

let ossClient: any = null;

function getOssClient(): any {
  if (ossClient) return ossClient;

  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    console.warn("[OSS] 配置不完整，图片上传功能已禁用");
    return null;
  }

  ossClient = new OSS({ region, bucket, accessKeyId, accessKeySecret });
  return ossClient;
}

function guessExtension(url: string): string {
  const pathPart = url.split("?")[0];
  const match = pathPart.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/i);
  return match ? match[1].toLowerCase() : "png";
}

export async function uploadImageToOss(
  downloadUrl: string,
  conversationId: string,
): Promise<string | null> {
  const client = getOssClient();
  if (!client) return null;

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      console.warn(`[OSS] 图片下载失败: HTTP ${response.status}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const extension = guessExtension(downloadUrl);
    const safeConvId = conversationId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const ossKey = `chat-images/${safeConvId}/${timestamp}_${random}.${extension}`;

    const result = await client.put(ossKey, buffer);
    console.log(`[OSS] 图片已上传 | key=${ossKey} | size=${buffer.length}`);
    return result.url;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[OSS] 图片上传失败: ${errorMessage}`);
    return null;
  }
}

interface RichTextItem {
  text?: string;
  downLoadUrl?: string;
  ossUrl?: string;
}

export async function processPictureImage(
  msgContent: string,
  conversationId: string,
): Promise<string> {
  const client = getOssClient();
  if (!client) return msgContent;

  try {
    const content = JSON.parse(msgContent);
    // 铉铉图片消息可能的字段: downloadCode, photoURL, picURL
    const downloadUrl = content.downloadCode || content.photoURL || content.picURL || "";

    if (!downloadUrl) {
      console.warn(`[OSS] picture 消息未找到下载链接, 字段: ${Object.keys(content).join(",")}`);
      return msgContent;
    }

    console.log(`[OSS] 尝试下载图片: ${downloadUrl.slice(0, 100)}`);
    const ossUrl = await uploadImageToOss(downloadUrl, conversationId);
    if (ossUrl) {
      content.ossUrl = ossUrl;
      return JSON.stringify(content);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[OSS] picture 处理失败: ${errorMessage}`);
  }

  return msgContent;
}

export async function processRichTextImages(
  msgContent: string,
  conversationId: string,
): Promise<string> {
  const client = getOssClient();
  if (!client) return msgContent;

  try {
    const content = JSON.parse(msgContent);
    const richText: RichTextItem[] = content.richText;
    if (!Array.isArray(richText)) return msgContent;

    let modified = false;
    for (const item of richText) {
      if (item.downLoadUrl) {
        const ossUrl = await uploadImageToOss(item.downLoadUrl, conversationId);
        if (ossUrl) {
          item.ossUrl = ossUrl;
          modified = true;
        }
      }
    }

    if (modified) {
      content.richText = richText;
      return JSON.stringify(content);
    }
  } catch {
    // JSON 解析失败，原样返回
  }

  return msgContent;
}
