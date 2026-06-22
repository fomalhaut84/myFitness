const TOKEN_RE = /bot\d+:[A-Za-z0-9_-]+/g;
const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
]);

export function sanitizeMessage(msg: string): string {
  return msg.replace(TOKEN_RE, "bot<REDACTED>");
}

export function sanitizeError(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  const MAX_DEPTH = 5;
  while (cur != null && depth < MAX_DEPTH) {
    if (cur instanceof Error) {
      parts.push(`${cur.name}: ${sanitizeMessage(cur.message)}`);
      const withInner = cur as { error?: unknown; cause?: unknown };
      cur = withInner.error ?? withInner.cause;
    } else if (typeof cur === "string") {
      parts.push(sanitizeMessage(cur));
      break;
    } else {
      try {
        parts.push(sanitizeMessage(JSON.stringify(cur)));
      } catch {
        parts.push("[unserializable]");
      }
      break;
    }
    depth++;
  }
  return parts.join(" | ");
}

export function getErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  let depth = 0;
  while (cur != null && depth < 5) {
    if (cur && typeof cur === "object") {
      const obj = cur as { code?: unknown; error?: unknown; cause?: unknown };
      if (typeof obj.code === "string") return obj.code;
      cur = obj.error ?? obj.cause;
    } else {
      break;
    }
    depth++;
  }
  return undefined;
}

export function isNetworkError(err: unknown): boolean {
  const code = getErrorCode(err);
  return code !== undefined && NETWORK_CODES.has(code);
}

export function isHtmlParseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /can't parse entities|Bad Request:.*entit/i.test(msg);
}
