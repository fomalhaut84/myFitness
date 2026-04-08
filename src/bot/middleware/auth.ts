import type { Context, NextFunction } from "grammy";

const allowedChatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

export async function authMiddleware(ctx: Context, next: NextFunction) {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId || (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId))) {
    await ctx.reply("접근 권한이 없습니다.");
    return;
  }
  await next();
}
