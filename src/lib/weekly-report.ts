import { askAdvisor } from "@/lib/ai/claude-advisor";
import prisma from "@/lib/prisma";

const WEEKLY_REPORT_PROMPT = `이번 주 피트니스 데이터를 종합 분석해서 주간 리포트를 작성해줘.

다음 항목을 포함해줘:
1. 주간 운동 요약 (러닝 횟수, 총 거리, 평균 페이스)
2. 수면 분석 (평균 수면 시간, 수면 점수 추세)
3. 심박/HRV 트렌드 (피로도 판단)
4. 컨디션 종합 평가 (바디배터리, 스트레스)
5. 다음 주 추천 사항

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
