/**
 * #570: 시스템 프롬프트 동적 프로필 섹션 — 강도 평가 기준 + 러닝 파워 존 (순수).
 * 프롬프트 버전 본문(DB)이 아니라 코드가 붙이는 부분 (#552 §3).
 */

import { parseIntensityBasisSetting } from "@/lib/fitness/intensity";
import { resolveProfilePowerZones } from "@/lib/fitness/power-zones";

const BASIS_LINES = {
  hr: "심박 존 (활동 강도 라벨 · 존 분포 · 점수가 심박 기준)",
  power:
    "파워 우선 — 러닝 파워 기록이 있는 활동은 러닝 파워 존, 없는 활동 (러닝 외 · 파워 없는 러닝) 은 심박 존. 파워 기준 활동은 심박을 참고로만",
  auto:
    "자동 — 심박을 믿기 어려운 상황 (심박 영향 복약 기간 · 체감온도 28°C 이상) 의 러닝만 러닝 파워 존, 그 밖엔 심박 존. 활동별 intensityBasis · intensityBasisReason 확인",
} as const;

export function buildPowerSection(
  profile: {
    thresholdPower: number | null;
    thresholdPowerSource: string | null;
    powerZonesRaw: unknown;
    intensityBasis: string | null;
  } | null
): string[] {
  const basis = parseIntensityBasisSetting(profile?.intensityBasis);
  const lines = ["", `## 강도 평가 기준: ${BASIS_LINES[basis]}`];
  const power = profile ? resolveProfilePowerZones(profile) : null;
  if (!power) {
    if (basis !== "hr") lines.push("- 러닝 역치파워 미설정 — 파워 존 분포는 있지만 역치 대비 보정은 하지 않음");
    return lines;
  }
  lines.push("");
  lines.push(
    `## 러닝 파워 Zone (역치파워 ${power.thresholdPower} W · ${power.source === "garmin" ? "Garmin" : "역치 대비 계산"})`
  );
  for (const z of power.zones) {
    lines.push(`- Zone ${z.zone} (${z.label}): ${z.max === null ? `${z.min}+ W` : `${z.min}-${z.max} W`}`);
  }
  return lines;
}
