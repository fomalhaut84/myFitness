# M2-8 후속2: KST instant 정확화 + 리포트 재생성 reportDate 유지 + 텔레그램 미수신 안전망

## 배경

M2-8(`docs/specs/m2-8-date-fix.md`) 및 후속(`docs/specs/m2-8-followup-endDate-yesterday.md`)에서 KST 정합성과 fetcher 가드를 부분 보강했다. 다음 세 이슈가 잇달아 드러나 한 묶음으로 정리한다.

### (1) `utils.*KST` 함수가 진짜 KST midnight instant을 만들지 않음

```ts
// 현재 (문제)
export function nowKST(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
```

`toLocaleString("en-US", { timeZone: "Asia/Seoul" })` 결과는 KST 벽시계 시각의 문자열이지만, 그걸 `new Date(...)`로 다시 파싱하면 서버 로컬 타임존으로 해석된다. 즉 instant이 KST 벽시계와 timezone offset만큼 어긋난다 (UTC 서버에서 KST 9시 = UTC 0시인데 nowKST의 instant은 UTC 9시).

서버가 KST(`Asia/Seoul`)인 환경에서는 우연히 정상 동작하나, fetcher의 미래 가드를 정확하게 짤 수 없고(M2-8 후속 PR #89의 P2 5건 누적 원인), 다른 타임존 환경으로 옮기면 즉시 회귀.

### (2) 이브닝 리포트 재생성 시 `reportDate`가 다음날로 어긋남

`src/lib/daily-report.ts`의 `generateReport()`는 매번 `kstDateStr()`로 현재 KST 날짜를 산출해 `reportDate`로 사용. 23:50 생성한 이브닝 리포트를 00:10에 재생성하면 새 record의 `reportDate`가 다음날이 되어 원본과 분리됨. 사용자 의도("기존 리포트를 갱신")와 어긋남.

### (3) 텔레그램 모닝/이브닝 리포트 도착 안 함

- `myfitness-bot` PM2 프로세스 정상 동작 확인됨.
- `/report` 명령은 정상 작동 (DB 최신 record를 꺼내 응답).
- cron 자동 전송만 도착 안 됨.

가장 유력 원인 (코드상 식별 가능):
- `generateReport` → `askAdvisor()` (`claude -p` CLI) 가 cron 시각에 throw → cron의 try-catch가 삼키고 끝 → record도 안 만들어지고 텔레그램 알림도 없음.
- 사용자는 새벽/저녁에 무슨 일이 일어났는지 알 수 없음 (조용한 실패).

## 요구사항

### (1) KST 함수 재구현

- [ ] `utils.ts`에 `ymdKST(d?: Date): string` 헬퍼 (Intl.DateTimeFormat "en-CA" 사용)
- [ ] `todayKST()` / `yesterdayKST()` / `daysAgoKST(n)` 가 진짜 KST midnight instant Date 반환 (`new Date(\`${ymd}T00:00:00+09:00\`)`)
- [ ] `nowKST()` 제거 또는 `new Date()` 별칭 (instant은 절대시각이므로 변환 불필요, KST 변환은 출력 시)
- [ ] `todayKSTString()` 은 `ymdKST()` 사용
- [ ] 사용처 영향 검증: cron, syncAll, daily-report.preSyncForReport, fetcher 가드

### (2) 리포트 재생성 reportDate 유지

- [ ] `generateReport(category, prompt, force=true)`에서 해당 카테고리의 가장 최근 record를 찾아 그 `reportDate`를 유지
- [ ] 기존 record 없으면 현재 KST today로 폴백
- [ ] delete + create 트랜잭션 유지

### (3) 텔레그램 미수신 진단 + 안전망

- [ ] `daily-report.generateReport`에서 단계별 로그 (`preSync 시작/완료`, `askAdvisor 시작/완료/길이`)
- [ ] `askAdvisor` 결과가 falsy/empty면 명시적 throw → cron이 알아챔
- [ ] `scheduler.startBotScheduler` cron try-catch에서 실패 시 `sendToAll`로 에러 메시지 전송 (조용한 실패 차단)
- [ ] `sendToAll` 자체 호출 결과를 별도 로그로 가시화

## 비목표

- `claude -p` CLI 자체의 안정성 개선 (별도 이슈)
- AI 리포트 콘텐츠 품질 개선
- 모든 fetcher 가드 일괄 재정비 (utils 정확화 후 별도 이슈로 heart-rate 등 보강)
- `asOfDate`를 리포트 생성 파이프라인 전체(preSync 범위, MCP tool query, 프롬프트)로 관통 — 본 PR은 가드(today/yesterday만 허용)로 차단만, 진짜 과거 컨텍스트 재생성은 별도 이슈
- 잔여 KST 정합 회귀 (UTC 호스트 환경에서만 발현):
  - `src/lib/fitness/calorie-balance.ts`의 `summaryKey`가 로컬 자정으로 만들어져 KST midnight instant로 저장된 `DailySummary.date`와 키 어긋남 가능성
  - `src/lib/garmin/fetchers/sleep.ts`가 일부 위치에서 로컬 자정 저장
  - 현재 서버는 KST이라 영향 없음, 별도 이슈로 분리

## 기술 설계

### KST 헬퍼

```ts
export function ymdKST(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

export function todayKST(): Date {
  return new Date(`${ymdKST()}T00:00:00+09:00`);
}

export function yesterdayKST(): Date {
  const t = todayKST();
  t.setUTCDate(t.getUTCDate() - 1);
  return t;
}

export function daysAgoKST(n: number): Date {
  const t = todayKST();
  t.setUTCDate(t.getUTCDate() - n);
  return t;
}

export function todayKSTString(): string {
  return ymdKST();
}
```

`setUTCDate`는 instant 단위 1일 감산이라 KST midnight 그대로 KST midnight (전날). DST 영향 없음 (KST는 DST 없음).

### 리포트 재생성 reportDate

```ts
async function generateReport(category, prompt, force = false): Promise<string> {
  const dateStr = todayKSTString();
  
  if (!force) {
    const existing = await prisma.aIAdvice.findFirst({
      where: { category, reportDate: dateStr },
    });
    if (existing) return existing.response;
  }

  // force=true: 기존 카테고리 최신 record의 reportDate 유지
  const latest = force
    ? await prisma.aIAdvice.findFirst({
        where: { category },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const targetDate = latest?.reportDate ?? dateStr;

  console.log(`[${category}] preSync 시작`);
  await preSyncForReport();
  console.log(`[${category}] preSync 완료, askAdvisor 시작`);

  const { result } = await askAdvisor(prompt);
  console.log(`[${category}] askAdvisor 완료 (length=${result?.length ?? 0})`);

  if (!result || result.trim().length === 0) {
    throw new Error(`askAdvisor returned empty response for ${category}`);
  }

  // 트랜잭션: 같은 reportDate의 기존 record 삭제 + 새 create
  await prisma.$transaction([
    prisma.aIAdvice.deleteMany({ where: { category, reportDate: targetDate } }),
    prisma.aIAdvice.create({
      data: { category, reportDate: targetDate, prompt, response: result },
    }),
  ]);

  return result;
}
```

### cron 안전망

```ts
cron.schedule(morningSchedule, async () => {
  console.log("[bot-cron] 모닝 리포트 시작");
  try {
    const report = await generateMorningReport();
    const html = `☀️ <b>모닝 리포트</b>\n\n${mdToHtml(report)}`;
    await sendToAll(bot, html);
    console.log("[bot-cron] 모닝 리포트 전송 완료");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[bot-cron] 모닝 리포트 에러:", msg);
    // 조용한 실패 차단: 사용자에게 에러 알림
    try {
      await sendToAll(bot, `❌ 모닝 리포트 생성 실패: ${msg.slice(0, 500)}`);
    } catch {
      // 알림 자체도 실패 → 어쩔 수 없이 콘솔만
    }
  }
}, { timezone: "Asia/Seoul" });
```

이브닝 리포트도 동일.

## 테스트 계획

1. `npm run lint && npx tsc --noEmit && npm run build` 통과
2. KST 헬퍼 단위 테스트 (UTC/KST 환경 가정)
   - `ymdKST(new Date('2026-04-28T14:59:59Z'))` === `'2026-04-28'` (KST 23:59)
   - `ymdKST(new Date('2026-04-28T15:00:00Z'))` === `'2026-04-29'` (KST 00:00)
3. 리포트 재생성 시나리오:
   - 23:50 생성 → 00:10 재생성 → reportDate가 어제로 유지
4. 봇 cron 직접 호출 시뮬레이션 (또는 다음 실제 cron run 관찰):
   - askAdvisor 의도적 실패 시 텔레그램에 에러 알림 도착
   - 정상 시 단계별 로그 PM2에 표시

## 제외 사항

- 미래 날짜 데이터 백필
- 이전 리포트 record 중 reportDate가 어긋난 것 정리 (수동 SQL 별도)
