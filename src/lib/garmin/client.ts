import { GarminConnect } from "@flow-js/garmin-connect";
import path from "path";
import fs from "fs";

const TOKEN_DIR = path.resolve(process.cwd(), ".garmin-tokens");

function ensureTokenDir(): void {
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
  }
}

function getCredentials(): { username: string; password: string } {
  const username = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "GARMIN_EMAIL and GARMIN_PASSWORD must be set in environment variables"
    );
  }

  return { username, password };
}

let clientInstance: GarminConnect | null = null;
let isAuthenticated = false;

async function authenticate(client: GarminConnect): Promise<void> {
  ensureTokenDir();

  // 캐시된 토큰으로 로그인 시도
  try {
    if (fs.existsSync(path.join(TOKEN_DIR, "oauth1_token.json"))) {
      client.loadTokenByFile(TOKEN_DIR);
      // 토큰 유효성 검증 (간단한 API 호출)
      await client.getUserProfile();
      isAuthenticated = true;
      return;
    }
  } catch {
    // 토큰 만료 또는 무효 → 재로그인
  }

  // 이메일/비밀번호로 로그인
  const { username, password } = getCredentials();
  await client.login(username, password);
  client.exportTokenToFile(TOKEN_DIR);
  isAuthenticated = true;
}

export async function getGarminClient(): Promise<GarminConnect> {
  if (clientInstance && isAuthenticated) {
    return clientInstance;
  }

  const { username, password } = getCredentials();
  clientInstance = new GarminConnect({ username, password });

  await authenticate(clientInstance);
  return clientInstance;
}

export async function withReauth<T>(
  fn: (client: GarminConnect) => Promise<T>
): Promise<T> {
  const client = await getGarminClient();

  try {
    return await fn(client);
  } catch (error: unknown) {
    const status =
      error instanceof Error && "status" in error
        ? (error as { status: number }).status
        : undefined;

    if (status === 401 || status === 403) {
      // 토큰 만료 → 재인증 후 재시도
      isAuthenticated = false;
      clientInstance = null;
      const freshClient = await getGarminClient();
      return await fn(freshClient);
    }

    throw error;
  }
}

export function resetClient(): void {
  clientInstance = null;
  isAuthenticated = false;
}

/**
 * #383 Codex P2 (PR #387 2회차): 영속 토큰 폐기. `withReauth` 는 메모리 상태만 비우고 `authenticate()` 가 같은
 * `.garmin-tokens` 파일을 다시 읽으므로, 토큰이 profile 조회는 통과하지만 daily summary 를 privacyProtected 로 돌려주는
 * 경우엔 재인증이 무의미했다. 파일을 지우면 다음 인증이 이메일/비밀번호 로그인으로 가서 새 토큰을 발급·저장한다.
 * 파일이 없거나 삭제 실패는 무해 (로그만) — 어차피 상위에서 싱크 실패로 기록된다.
 */
export function evictPersistedToken(): void {
  for (const name of ["oauth1_token.json", "oauth2_token.json"]) {
    const file = path.join(TOKEN_DIR, name);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.warn(`[garmin] 토큰 파일 삭제 실패 (${name}):`, error instanceof Error ? error.message : String(error));
    }
  }
  resetClient();
}
