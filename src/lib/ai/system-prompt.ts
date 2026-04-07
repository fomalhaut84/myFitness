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

export async function buildSystemPrompt(): Promise<string> {
  return `${BASE_PROMPT}\n## 현재 시간\n${formatKSTDateTime()}\n`;
}
