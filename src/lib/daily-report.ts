import { askAdvisor } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";

function todayKSTString(): string {
  const kst = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
  );
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MORNING_PROMPT = `모닝 리포트를 작성해줘.

어젯밤 수면 데이터와 현재 회복 상태를 분석해줘:
- 수면 점수, 수면 단계별 시간 (깊은/얕은/REM/깨어남)
- SpO2, 호흡수, 야간 HRV
- 기상 시 바디배터리 (bodyBatteryHigh 기준)
- 수면 중 안정시 심박수
- 바디배터리 충전량으로 회복 상태 평가
- 오늘의 운동 추천 (회복 상태 기반 강도 제안)

간결한 마크다운으로 작성.`;

const EVENING_PROMPT = `이브닝 리포트를 작성해줘.

오늘 하루의 활동 데이터를 정리하고 평가해줘:
- 오늘 운동 기록이 있으면 분석 (거리, 페이스, HR, TE)
- 걸음 수, 활동 칼로리
- 스트레스 분포 (고/중/저 비율)
- 바디배터리 소모량 (bodyBatteryDrained) vs 충전량 (bodyBatteryCharged) 비교
- 취침 전 회복 필요성 평가
- 내일 운동 계획 제안

간결한 마크다운으로 작성.`;

export async function generateMorningReport(): Promise<string> {
  const dateStr = todayKSTString();

  // 중복 방지
  const existing = await prisma.aIAdvice.findFirst({
    where: { category: "morning_report", reportDate: dateStr },
  });
  if (existing) {
    console.log(`[morning-report] ${dateStr} 이미 존재, 건너뜀`);
    return existing.response;
  }

  const { result } = await askAdvisor(MORNING_PROMPT);

  await prisma.aIAdvice.create({
    data: {
      category: "morning_report",
      reportDate: dateStr,
      prompt: MORNING_PROMPT,
      response: result,
    },
  });

  console.log(`[morning-report] ${dateStr} 생성 완료`);
  return result;
}

export async function generateEveningReport(): Promise<string> {
  const dateStr = todayKSTString();

  const existing = await prisma.aIAdvice.findFirst({
    where: { category: "evening_report", reportDate: dateStr },
  });
  if (existing) {
    console.log(`[evening-report] ${dateStr} 이미 존재, 건너뜀`);
    return existing.response;
  }

  const { result } = await askAdvisor(EVENING_PROMPT);

  await prisma.aIAdvice.create({
    data: {
      category: "evening_report",
      reportDate: dateStr,
      prompt: EVENING_PROMPT,
      response: result,
    },
  });

  console.log(`[evening-report] ${dateStr} 생성 완료`);
  return result;
}
