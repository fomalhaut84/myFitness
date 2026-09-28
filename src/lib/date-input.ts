// #480: date-only 입력 ("YYYY-MM-DD" — 프로필 생일 · 목표일 · 수동 체성분) 의 저장 규칙. 이전 두 route 의 `parseLocalDate` 는
// `new Date(y, m - 1, d)` = 서버 로컬 자정이라, 읽기가 KST 인 (#365) 상태에서 호스트가 서울보다 동쪽이면 하루 앞으로 읽혔다.
// Garmin 일별 키와 같은 KST 자정 instant 로 저장한다 — 호스트 TZ 무관. 순수.
import { isValidYmd, kstInstant } from "@/lib/history/buckets";

/** "YYYY-MM-DD" → KST 자정 instant. 실존하지 않는 날짜 · 형식 오류는 throw (라우트는 zod 가 먼저 거른다 — 이중 방어) */
export function parseDateOnlyKST(ymd: string): Date {
  if (!isValidYmd(ymd)) throw new TypeError(`date-only 입력이 아닙니다: ${JSON.stringify(ymd)}`);
  return kstInstant(ymd);
}
