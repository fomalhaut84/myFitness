/**
 * #514: OMRON Connect 설정. 앱 ID · 키 · API base 는 OMRON 소유값이라 저장소에 두지 않고 env 로만 받는다
 * (#514 결정 — GPL-2.0 참고 구현의 데이터 파일도 가져오지 않는다).
 */
import { z } from "zod";

const envSchema = z.object({
  OMRON_EMAIL: z.string().min(1),
  OMRON_PASSWORD: z.string().min(1),
  OMRON_APP_ID: z.string().min(1),
  OMRON_APP_KEY: z.string().min(1),
  OMRON_API_BASE: z.url(),
});

export interface OmronConfig {
  email: string;
  password: string;
  appId: string;
  appKey: string;
  apiBase: string;
}

export type OmronConfigResult =
  | { enabled: true; config: OmronConfig }
  | { enabled: false; missing: string[] };

/** 5개 중 하나라도 없거나 형식이 틀리면 비활성 — OMRON 싱크만 건너뛰고 에러로 취급하지 않는다 (스펙 P1) */
export function readOmronConfig(env: NodeJS.ProcessEnv = process.env): OmronConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    return { enabled: false, missing };
  }
  const e = parsed.data;
  return {
    enabled: true,
    config: {
      email: e.OMRON_EMAIL,
      password: e.OMRON_PASSWORD,
      appId: e.OMRON_APP_ID,
      appKey: e.OMRON_APP_KEY,
      apiBase: e.OMRON_API_BASE.replace(/\/+$/, ""),
    },
  };
}
