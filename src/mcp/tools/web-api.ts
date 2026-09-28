// #444 (사전 리뷰 info 4): MCP → 웹 앱 HTTP 경유 공용. Garmin 세션 (`withReauth`) 은 웹 프로세스에만 두므로
// 스플릿 · 활동 컨텍스트처럼 Garmin 을 거치는 조회는 MCP 프로세스가 직접 하지 않고 웹 API 를 부른다.
// claude-advisor 가 MCP env 로 APP_BASE_URL 을 전달.

const DEFAULT_BASE_URL = "http://localhost:4200";

export type WebApiResult = { ok: true; body: unknown } | { ok: false; error: string };

/** 웹 앱 GET → JSON. HTTP 오류 · 네트워크 예외 · JSON 파싱 실패는 전부 `{ ok: false, error }` (조용히 삼키지 않는다) */
export async function fetchWebJson(path: string, label: string): Promise<WebApiResult> {
  const baseUrl = process.env.APP_BASE_URL ?? DEFAULT_BASE_URL;
  try {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, error: `${label} 조회 실패 (${res.status}): ${body?.error ?? res.statusText}` };
    }
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, error: `${label} API 호출 실패: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** MCP 도구 오류 응답 (isError) */
export function errorPayload(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
