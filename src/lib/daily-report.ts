import { askAdvisor } from "@/lib/ai/claude-advisor";
import { syncAll } from "@/lib/garmin/sync";
import { daysAgoKST, todayKST, todayKSTString as kstDateStr } from "@/lib/garmin/utils";
import prisma from "@/lib/prisma";

const MORNING_PROMPT = `모닝 리포트를 작성해줘.

어젯밤 수면 데이터와 현재 회복 상태를 분석하고, 감량 진행도를 포함해줘:
- 수면 점수, 수면 단계별 시간 (깊은/얕은/REM/깨어남)
- SpO2, 호흡수, 야간 HRV
- 기상 시 바디배터리 (bodyBatteryHigh 기준)
- 수면 중 안정시 심박수
- 바디배터리 충전량으로 회복 상태 평가
- 어제 칼로리 밸런스 (get_weight_loss_status 도구로 조회): 결손/잉여 평가 + 주간 추세
- 체중 추세: 최근 7일 변화, 감량 페이스가 적정(주 0.5kg)인지
- 오늘의 운동 추천 (회복 상태 + 칼로리 밸런스 고려, Zone 기반 강도 제안)
- 경고 규칙에 해당하면 반드시 경고 포함

간결한 마크다운으로 작성.`;

const EVENING_PROMPT = `이브닝 리포트를 작성해줘.

오늘 하루의 활동 데이터를 정리하고, 강도 분석과 칼로리 밸런스를 포함해줘:
- 오늘 운동 기록이 있으면 분석 (거리, 페이스, HR, TE, intensityLabel, Zone 분포)
- 걸음 수, 활동 칼로리
- 오늘 칼로리 밸런스 (결손/잉여, 섭취 vs 섭취가능) — get_weight_loss_status로 조회
- 스트레스 분포 (고/중/저 비율)
- 바디배터리 소모량 (bodyBatteryDrained) vs 충전량 (bodyBatteryCharged) 비교
- 취침 전 회복 필요성 평가 (고강도 운동 후 회복 경고 규칙 확인)
- 내일 운동 계획 제안 (Zone 기반, 칼로리 밸런스 고려)
- 경고 규칙에 해당하면 반드시 경고 포함

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
  force = false,
  reportDate?: string
): Promise<string> {
  const dateStr = kstDateStr();
  // reportDate 명시됐으면 그것 사용 (UI 재생성 버튼 등 자정 넘김 케이스).
  // 미명시면 KST today.
  const targetDate = reportDate ?? dateStr;

  // force가 아니면 기존 리포트 반환
  if (!force) {
    const existing = await prisma.aIAdvice.findFirst({
      where: { category, reportDate: targetDate },
    });
    if (existing) {
      console.log(`[${category}] ${targetDate} 이미 존재, 건너뜀`);
      return existing.response;
    }
  }

  console.log(`[${category}] preSync 시작 (target=${targetDate})`);
  await preSyncForReport();
  console.log(`[${category}] preSync 완료, askAdvisor 시작`);

  const { result } = await askAdvisor(prompt);
  console.log(`[${category}] askAdvisor 완료 (length=${result?.length ?? 0})`);

  // 조용한 실패 차단: 빈 응답이면 명시적 throw → 호출자(cron)가 알아챔
  if (!result || result.trim().length === 0) {
    throw new Error(`askAdvisor returned empty response for ${category}`);
  }

  // 트랜잭션: 같은 reportDate의 기존 record 삭제 + 새 create.
  // force=false 케이스에서도 동일 트랜잭션 사용 (race condition 시 중복 방지).
  await prisma.$transaction([
    prisma.aIAdvice.deleteMany({ where: { category, reportDate: targetDate } }),
    prisma.aIAdvice.create({
      data: { category, reportDate: targetDate, prompt, response: result },
    }),
  ]);
  console.log(`[${category}] ${targetDate} ${force ? "재생성" : "생성"} 완료`);

  return result;
}

export async function generateMorningReport(
  force = false,
  reportDate?: string
): Promise<string> {
  return generateReport("morning_report", MORNING_PROMPT, force, reportDate);
}

export async function generateEveningReport(
  force = false,
  reportDate?: string
): Promise<string> {
  return generateReport("evening_report", EVENING_PROMPT, force, reportDate);
}
