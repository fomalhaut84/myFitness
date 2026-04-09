import { askAdvisor } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import { daysAgoKST, todayKST, todayKSTString as kstDateStr } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";

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

/** 리포트 생성 전 최신 데이터 싱크 */
async function preSyncForReport(): Promise<void> {
  try {
    console.log("[report] 리포트 전 데이터 싱크 시작");
    await syncAll({
      startDate: daysAgoKST(1),
      endDate: todayKST(),
      dataTypes: ["sleep", "daily_stats", "heart_rate", "activities"],
    });
    console.log("[report] 리포트 전 데이터 싱크 완료");
  } catch (error) {
    console.warn("[report] 리포트 전 싱크 실패, 기존 데이터로 진행:", error);
  }
}

async function generateReport(
  category: string,
  prompt: string,
  force = false
): Promise<string> {
  const dateStr = kstDateStr();

  // force가 아니면 기존 리포트 반환
  if (!force) {
    const existing = await prisma.aIAdvice.findFirst({
      where: { category, reportDate: dateStr },
    });
    if (existing) {
      console.log(`[${category}] ${dateStr} 이미 존재, 건너뜀`);
      return existing.response;
    }
  }

  // 리포트 전 데이터 최신화
  await preSyncForReport();

  const { result } = await askAdvisor(prompt);

  try {
    if (force) {
      // 트랜잭션으로 삭제+생성을 원자적으로 (유실 방지)
      await prisma.$transaction([
        prisma.aIAdvice.deleteMany({ where: { category, reportDate: dateStr } }),
        prisma.aIAdvice.create({
          data: { category, reportDate: dateStr, prompt, response: result },
        }),
      ]);
    } else {
      await prisma.aIAdvice.create({
        data: { category, reportDate: dateStr, prompt, response: result },
      });
    }
    console.log(`[${category}] ${dateStr} ${force ? "재생성" : "생성"} 완료`);
  } catch {
    console.log(`[${category}] ${dateStr} 중복, 기존 리포트 사용`);
    const fallback = await prisma.aIAdvice.findFirst({
      where: { category, reportDate: dateStr },
    });
    if (fallback) return fallback.response;
  }

  return result;
}

export async function generateMorningReport(force = false): Promise<string> {
  return generateReport("morning_report", MORNING_PROMPT, force);
}

export async function generateEveningReport(force = false): Promise<string> {
  return generateReport("evening_report", EVENING_PROMPT, force);
}
