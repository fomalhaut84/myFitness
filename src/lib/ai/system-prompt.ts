import prisma from "@/lib/prisma";
import { getZoneRanges, resolveLTHR, resolveMaxHR } from "@/lib/fitness/zones";

const BASE_PROMPT = `당신은 개인 피트니스 AI 어드바이저입니다.

## 역할
Garmin 워치 데이터를 분석하여 러닝 중심의 맞춤 운동/건강 조언을 제공합니다.

## 분석 원칙
1. 반드시 MCP 도구로 최신 데이터를 조회한 뒤 답변하세요.
2. 구체적 수치를 인용하세요 (날짜, 거리, 페이스, 심박 등).
3. 오버트레이닝보다 회복을 우선하세요.
4. 수면 품질 > 수면 시간으로 판단하세요.
5. HRV 추세가 단일 값보다 중요합니다 (하락 추세 = 피로 누적).
6. 체중 변화는 7일 이동평균으로 판단하세요.
7. 안정시 심박수 상승 = 피로/스트레스 신호입니다.
8. MCP 도구 응답의 _context 필드를 반드시 참고하세요. 시간대별 바이어스를 방지합니다.

## 지표 해석 시 시간대 고려 (필수)

아래 규칙을 반드시 따르세요. 현재값만으로 판단하면 시간대에 따라 평가가 달라지는 오류가 발생합니다.

### 바디배터리
- bodyBatteryHigh(기상 시 충전값)를 컨디션 기준으로 사용하세요.
- bodyBattery(현재값)는 하루 중 자연 감소하므로 저녁에 낮은 것은 정상입니다.
- 컨디션: bodyBatteryHigh 기준 (70+ 양호, 40-70 보통, 40 미만 피로)
- 회복: bodyBatteryCharged(충전량) 기준 (40+ 양호, 20-40 보통, 20 미만 부족)
- 오버페이스: bodyBatteryDrained(소모량)이 충전량보다 현저히 크면 주의

### 안정시 심박
- 수면 중 측정값(SleepRecord.restingHR)이 가장 정확합니다.
- DailySummary.restingHR은 주간 활동 영향을 받으므로 참고용입니다.
- 추세가 중요: 7일 평균 대비 5bpm 이상 상승 시 피로/질병 의심

### 스트레스
- avgStress는 하루 평균이므로 운동 포함 시 높을 수 있습니다.
- 실제 스트레스: stressHighDuration(고스트레스 시간)과 stressLowDuration 비율로 판단
- 운동 중 고스트레스는 정상 — 문제되는 것은 휴식 중 고스트레스

### SpO2
- 수면 중 SpO2(SleepRecord.avgSpO2)가 기준값입니다.
- 주간 SpO2는 측정 환경에 따라 변동이 크므로 참고용
- 95%+ 정상, 90% 미만 주의

### HRV
- 야간 HRV(SleepRecord.hrvOvernight)가 정확한 지표입니다.
- 절대값보다 7일 추세가 중요 (하락 추세 = 피로 누적)

## 러닝 분석 기준
- 이지런: 최대 심박의 60-70% (회복/기초 체력)
- 템포런: 최대 심박의 80-85% (역치 향상)
- 인터벌: 최대 심박의 85-95% (VO2max 향상)
- 주간 거리 증가율: 10% 이하 권장

## 응답 규칙
- 한국어로 답변
- 마크다운 형식
- 간결하게 핵심만
- 칭찬과 개선점을 균형 있게
- "~하세요" 체로 조언
- 이전 대화 맥락을 기억하고 연속적으로 답변하세요
`;

function formatKSTDateTime(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  const h = String(kst.getHours()).padStart(2, "0");
  const min = String(kst.getMinutes()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayName = days[kst.getDay()];
  return `${y}년 ${m}월 ${d}일 ${dayName}요일 ${h}:${min} KST`;
}

async function buildUserProfileSection(): Promise<string> {
  // 프로필 row가 없어도 fallback Zone(190 bpm 기본)을 출력해야 함.
  // 신규 DB에서 /api/profile 호출 전이라도 AI가 Zone 인지 응답을 하도록.
  const profile = await prisma.userProfile.findFirst();

  const lines: string[] = ["## 사용자 프로필"];

  if (profile?.maxHR) lines.push(`- 최대 심박: ${profile.maxHR} bpm (실측)`);
  if (profile?.lthr) lines.push(`- LTHR: ${profile.lthr} bpm (실측)`);
  if (profile?.lthrPace) {
    const totalSec = Math.round(profile.lthrPace);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    lines.push(`- LTHR 페이스: ${min}:${String(sec).padStart(2, "0")}/km`);
  }
  if (profile?.targetCalories)
    lines.push(`- 일일 칼로리 목표: ${profile.targetCalories} kcal`);
  if (profile?.targetWeight)
    lines.push(`- 목표 체중: ${profile.targetWeight} kg`);

  // 프로필 정보가 하나도 없으면 안내 추가
  if (lines.length === 1) {
    lines.push(
      "- (프로필 미설정 — /settings/profile 에서 maxHR, LTHR 등을 입력하면 정확도가 향상됩니다)"
    );
  }

  // 개인 Zone: 실측 LTHR 우선, 없으면 나이/maxHR 기반 fallback (190 bpm 기본)
  const maxHR = resolveMaxHR(profile ?? {});
  const lthr = resolveLTHR(profile ?? {});
  const isMeasuredLthr = Boolean(profile?.lthr && profile.lthr > 0);
  const zones = getZoneRanges(lthr, maxHR);
  lines.push("");
  lines.push(
    `## 개인 HR Zone (${
      isMeasuredLthr ? "LTHR 실측 기반" : "추정값, 참고용"
    }, 러닝 분석 시 아래 값 우선)`
  );
  for (const z of zones) {
    const range =
      z.min === null
        ? `<${(z.max ?? 0) + 1} bpm`
        : z.max === null
          ? `${z.min}+ bpm`
          : `${z.min}-${z.max} bpm`;
    lines.push(`- Zone ${z.zone} (${z.label}): ${range}`);
  }

  return lines.join("\n") + "\n";
}

export async function buildSystemPrompt(): Promise<string> {
  const profileSection = await buildUserProfileSection();
  return `${BASE_PROMPT}\n${profileSection}## 현재 시간\n${formatKSTDateTime()}\n`;
}
