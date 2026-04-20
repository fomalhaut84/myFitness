import { askAdvisor } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";

const WEEKLY_REPORT_PROMPT = `이번 주 피트니스 데이터를 종합 분석해서 주간 리포트를 작성해줘.

다음 항목을 포함해줘:
1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스, 강도 분류별 횟수)
2. 수면 분석 (평균 수면 시간, 수면 점수 추세)
3. 심박/HRV 트렌드 (피로도 판단)
4. 컨디션 종합 평가 (바디배터리, 스트레스)
5. 칼로리 밸런스 주간 요약 (get_weight_loss_status로 조회):
   - 주간 평균 결손/잉여
   - 감량 페이스 평가 (적정/과도/부족)
   - 체중 변화 (7일 이동평균 기준)
6. 경고 사항 (시스템 프롬프트의 경고 규칙에 해당하면 반드시 포함)
7. 다음 주 추천 사항 (Zone 기반 훈련 배분 + 칼로리 밸런스 관리)

마크다운 형식으로 간결하게 작성해줘.`;

export async function generateWeeklyReport(): Promise<string> {
  try {
    const { result } = await askAdvisor(WEEKLY_REPORT_PROMPT);

    // DB에 저장
    await prisma.aIAdvice.create({
      data: {
        category: "weekly_report",
        prompt: WEEKLY_REPORT_PROMPT,
        response: result,
      },
    });

    console.log("[weekly-report] 주간 리포트 생성 완료");
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[weekly-report] 리포트 생성 실패:", msg);
    throw error;
  }
}
