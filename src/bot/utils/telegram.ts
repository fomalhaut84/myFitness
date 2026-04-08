import type { Context } from "grammy";

const MAX_MESSAGE_LENGTH = 4096;

/** 마크다운을 텔레그램 HTML로 간단 변환 */
export function mdToHtml(md: string): string {
  return md
    .replace(/### (.+)/g, "<b>$1</b>")
    .replace(/## (.+)/g, "<b>$1</b>")
    .replace(/# (.+)/g, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n- /g, "\n• ");
}

/** HTML 특수문자 이스케이프 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 긴 메시지 분할 전송 */
export async function replyLong(ctx: Context, text: string, html = false) {
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: html ? "HTML" : undefined });
    } catch {
      // HTML 파싱 실패 시 plain text로 fallback
      await ctx.reply(chunk.replace(/<[^>]*>/g, ""));
    }
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
