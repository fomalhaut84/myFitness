/**
 * #514: OMRON Connect HTTP 클라이언트 — 인증 (refresh token 우선 · 실패 시 비밀번호) · 401 재인증 1회.
 * 프로토콜은 자체 PoC 실측 (스펙 §2-1). refresh token 은 회전하지 않아 파일에 보관해 재사용한다.
 * 토큰 · 비밀번호는 로그에 남기지 않는다.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { OmronConfig } from "./config";

const TOKEN_DIR = path.resolve(process.cwd(), ".omron-tokens");
const TOKEN_FILE = path.join(TOKEN_DIR, "refresh-token.json");
const REQUEST_TIMEOUT_MS = 20_000;
/** 만료 직전 요청이 401 로 떨어지지 않게 여유를 둔다 */
const EXPIRY_MARGIN_MS = 60_000;

/** 인증 실패 (계정 · 비밀번호 · 앱 키) — 관리자 알림 분류용 */
export class OmronAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmronAuthError";
  }
}

export class OmronHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "OmronHttpError";
  }
}

interface Session {
  accessToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

/**
 * 토큰을 발급받은 계정 · 앱 · 서버 식별자 (해시 — 이메일을 파일에 평문으로 두지 않는다).
 * PR #518 Codex P2: OMRON_EMAIL 을 바꿨는데 이전 계정 토큰이 남아 있으면 그 계정으로 로그인돼 다른 사람 데이터를 가져온다.
 */
export function tokenAccountKey(config: Pick<OmronConfig, "email" | "appId" | "apiBase">): string {
  return createHash("sha256").update(`${config.apiBase}\n${config.appId}\n${config.email.trim().toLowerCase()}`).digest("hex");
}

/** 저장 파일 내용 → 이 계정의 refresh token. 계정이 다르거나 형식이 틀리면 null (순수) */
export function storedTokenFor(fileContent: string, accountKey: string): string | null {
  try {
    const parsed = JSON.parse(fileContent) as { refreshToken?: unknown; account?: unknown };
    if (parsed.account !== accountKey) return null;
    return typeof parsed.refreshToken === "string" && parsed.refreshToken.length > 0 ? parsed.refreshToken : null;
  } catch {
    return null;
  }
}

function readStoredRefreshToken(accountKey: string): string | null {
  try {
    return storedTokenFor(fs.readFileSync(TOKEN_FILE, "utf8"), accountKey);
  } catch {
    return null; // 파일 없음 → 비밀번호 로그인
  }
}

function storeRefreshToken(refreshToken: string, accountKey: string): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ refreshToken, account: accountKey, savedAt: new Date().toISOString() }),
    { mode: 0o600 }
  );
  // mode 는 새로 만들 때만 적용된다 — 기존 파일도 0600 으로 (사전 리뷰 info 4)
  fs.chmodSync(TOKEN_FILE, 0o600);
}

function clearStoredRefreshToken(): void {
  fs.rmSync(TOKEN_FILE, { force: true });
}

function baseHeaders(config: OmronConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    // PoC: 비압축 응답 요청 (gzip 표기 이슈 회피)
    "accept-encoding": "identity",
    "X-Kii-AppID": config.appId,
    "X-Kii-AppKey": config.appKey,
  };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
}

export class OmronClient {
  private session: Session | null = null;

  constructor(private readonly config: OmronConfig) {}

  /**
   * 토큰 요청. 자격 증명 거절 (400 · 401) 이면 null, 서버 장애 · rate limit 등 그 외 실패는 OmronHttpError —
   * 일시 장애로 저장된 refresh token 을 지우거나 "인증 실패" 로 오분류하지 않게 (사전 리뷰 info 1).
   */
  private async requestToken(body: Record<string, string>): Promise<Session | null> {
    const { status, json } = await postJson(`${this.config.apiBase}/oauth2/token`, baseHeaders(this.config), body);
    const t = (json ?? {}) as TokenResponse;
    if (status === 400 || status === 401) return null;
    if (status !== 200 || typeof t.access_token !== "string") {
      throw new OmronHttpError(`OMRON 토큰 요청 실패: HTTP ${status}`, status);
    }
    if (typeof t.refresh_token === "string") storeRefreshToken(t.refresh_token, tokenAccountKey(this.config));
    const expiresInSec = typeof t.expires_in === "number" && t.expires_in > 0 ? t.expires_in : 3600;
    return { accessToken: t.access_token, expiresAt: Date.now() + expiresInSec * 1000 };
  }

  private async authenticate(): Promise<Session> {
    const stored = readStoredRefreshToken(tokenAccountKey(this.config));
    if (stored) {
      const refreshed = await this.requestToken({ grant_type: "refresh_token", refresh_token: stored });
      if (refreshed) return refreshed;
      clearStoredRefreshToken();
    }
    const loggedIn = await this.requestToken({ username: this.config.email, password: this.config.password });
    if (!loggedIn) throw new OmronAuthError("OMRON 로그인 실패 — OMRON_EMAIL / OMRON_PASSWORD / 앱 키 확인");
    return loggedIn;
  }

  private async getSession(): Promise<Session> {
    if (this.session && this.session.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return this.session;
    this.session = await this.authenticate();
    return this.session;
  }

  /** `{apiBase}/apps/{appId}/server-code/versions/current/{endpoint}` 호출. 401 이면 재인증 후 1회 재시도 */
  async callServerCode(endpoint: string, body: unknown): Promise<unknown> {
    const url = `${this.config.apiBase}/apps/${this.config.appId}/server-code/versions/current/${endpoint}`;
    for (const attempt of [1, 2]) {
      const session = await this.getSession();
      const { status, json } = await postJson(
        url,
        { ...baseHeaders(this.config), authorization: `Bearer ${session.accessToken}` },
        body
      );
      if (status === 200) return json;
      if (status === 401) {
        this.session = null;
        if (attempt === 1) continue;
        // PR #518 Codex P2: 재인증 직후에도 401 → 인증 실패로 분류해 관리자 알림. 쓸 수 없는 refresh token 은 지운다
        clearStoredRefreshToken();
        throw new OmronAuthError(`OMRON ${endpoint} 재인증 후에도 401`);
      }
      throw new OmronHttpError(`OMRON ${endpoint} 실패: HTTP ${status}`, status);
    }
    throw new OmronAuthError(`OMRON ${endpoint} 인증 재시도 소진`);
  }
}
