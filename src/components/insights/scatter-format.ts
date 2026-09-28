// #397: 산점도 축 포맷 — 서버 → 클라이언트 경계를 넘어야 하므로 함수가 아니라 이름으로 넘기고 여기서 해석한다. 순수 (테스트 대상).
import { formatPace } from "@/lib/format";

export type AxisFormat = "pace" | "int" | "degrees" | "year";

export function formatAxis(kind: AxisFormat, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  switch (kind) {
    case "pace":
      return formatPace(value);
    case "degrees":
      return `${Math.round(value)}°`;
    case "int":
      return String(Math.round(value));
    case "year":
      // #425: 소수 연도 (시간 축) → 정수 연도
      return String(Math.floor(value));
  }
}
