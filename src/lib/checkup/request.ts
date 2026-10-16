// #527: POST · PUT 공통 — 본문 검증 → 미래 검진일 거부 → 저장 행 빌드. 순수 (오늘 날짜는 호출자가 준다).
import { buildResultRows, type CheckupResultRow } from "./build";
import { CHECKUP_INPUT, type CheckupInput } from "./schema";

export type PreparedWrite =
  | { ok: true; input: CheckupInput; rows: CheckupResultRow[] }
  | { ok: false; status: 400; body: { error: string; issues?: unknown } };

export function prepareCheckupWrite(body: unknown, todayYmd: string): PreparedWrite {
  const parsed = CHECKUP_INPUT.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: "유효하지 않은 입력", issues: parsed.error.issues } };
  }
  if (parsed.data.date > todayYmd) {
    return { ok: false, status: 400, body: { error: "미래 날짜의 검진은 기록할 수 없습니다" } };
  }
  const built = buildResultRows(parsed.data.results);
  if (!built.ok) return { ok: false, status: 400, body: { error: built.error } };
  return { ok: true, input: parsed.data, rows: built.rows };
}
