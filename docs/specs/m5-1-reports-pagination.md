# M5-1: 리포트 페이지 페이지네이션 + 타입 필터

- **작성일**: 2026-06-22
- **타입**: feature (P1)
- **마일스톤**: M5 (`docs/specs/m5-overview.md`)
- **백엔드 전용 아님** — UI 변경 포함이지만 기존 `/reports` 페이지 확장이라 신규 디자인 단계 생략(기존 카드 레이아웃 유지 + 상단 필터 토글 + 하단 더 보기 버튼만 추가).

## 1. 목적

`/reports` 페이지는 현재 최근 14일치만 한 번에 가져옴. 모닝(1/일) + 이브닝(1/일) + 주간(1/주) 누적으로 6개월이면 360+ 건. 이전 리포트 접근 수단 없음 → 사용자 명시 요청.

## 2. 요구사항

### 2.1 기능 요구사항

- [ ] **F1**: `GET /api/reports` 가 `cursor`(`<createdAt ISO 8601>|<id>` 복합키 문자열, 예: `2026-06-22T01:30:00.000Z|cl9xyz123abc`) + `limit`(1~50, default 14) 파라미터를 받아 cursor 기반 페이지네이션 수행. 복합키 형식은 동일 `createdAt` 다건 경계 시 누락 방지를 위한 키셋 페이지네이션. 형식 위반 시 400.
- [ ] **F2**: 응답에 `nextCursor` 포함. 다음 페이지가 없으면 `null`.
- [ ] **F3**: 기존 `type`/`date`/`days` 파라미터 호환 유지. `cursor` 가 명시되면 `days` 무시(전체 범위에서 cursor 이후만 조회). `date` 는 단일 날짜 조회용으로 cursor와 상호배타.
- [ ] **F4**: 응답 envelope 형식: `{ data: Report[], nextCursor: string | null }` (기존 `{ data }` 호환 — `nextCursor` 추가만).
- [ ] **F5**: `/reports` 페이지에 타입 필터 토글 추가 (전체 / 모닝 / 이브닝 / 주간). 클릭 시 reports state 초기화 + 첫 페이지 재요청.
- [ ] **F6**: 페이지 하단에 "더 보기" 버튼. `nextCursor === null` 이면 숨김. 로딩 중에는 비활성화 + 텍스트 변경("불러오는 중...").
- [ ] **F7**: 더 보기로 가져온 데이터는 기존 reports 배열에 append (덮어쓰기 ❌).

### 2.2 비기능 요구사항

- [ ] 첫 페이지 응답 200ms 이내 (DB 인덱스: `aIAdvice.createdAt` 이미 정렬 효율).
- [ ] cursor 안정성: 동일 `createdAt` 가 여러 건이어도 페이지 누락/중복 없음 (보조 정렬키 `id`).
- [ ] 필터 변경 시 진행 중인 fetch 응답이 새 필터에 섞이지 않도록 race condition 방어.

## 3. 기술 설계

### 3.1 API 변경 — `src/app/api/reports/route.ts`

현재 동작:
```ts
where.createdAt = { gte: since };  // days 기반
const reports = await prisma.aIAdvice.findMany({
  where, orderBy: { createdAt: "desc" }, take: 30, select: {...}
});
return NextResponse.json({ data: ... });
```

변경 후:
```ts
const cursor = url.searchParams.get("cursor");  // ISO string of createdAt
const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "14")));

// where.category 필터는 기존 유지
if (date) {
  where.reportDate = date;
} else if (cursor) {
  // cursor < createdAt: cursor 시각보다 더 이전 (오래된) 레코드만
  where.createdAt = { lt: new Date(cursor) };
} else {
  // 후방 호환: days 파라미터
  const since = new Date();
  since.setDate(since.getDate() - days);
  where.createdAt = { gte: since };
}

// take를 limit+1로 해서 다음 페이지 존재 여부 판단
const rows = await prisma.aIAdvice.findMany({
  where,
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],  // 보조 정렬키
  take: limit + 1,
  select: { id, category, reportDate, response, createdAt },
});

const hasMore = rows.length > limit;
const data = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
}));
const nextCursor = hasMore ? data[data.length - 1].createdAt : null;

return NextResponse.json({ data, nextCursor });
```

**근거**:
- `take: limit+1` 후 잘라내는 패턴이 별도 count 쿼리 없이 hasMore 판단 가능 — Prisma cursor 가이드 표준 패턴.
- `orderBy` 보조 키 `id desc` 로 `createdAt` 동일 시 안정 정렬.
- cursor 형식: `createdAt.toISOString()`. URL-safe (콜론 인코딩만 주의 — 클라가 `encodeURIComponent`).

### 3.2 UI 변경 — `src/app/reports/page.tsx`

state 확장:
```ts
const [reports, setReports] = useState<Report[]>([]);
const [nextCursor, setNextCursor] = useState<string | null>(null);
const [filter, setFilter] = useState<"all" | "morning" | "evening" | "weekly">("all");
const [loadingMore, setLoadingMore] = useState(false);
const requestIdRef = useRef(0);  // race condition 방어
```

첫 로드 / 필터 변경 시:
```ts
useEffect(() => {
  const reqId = ++requestIdRef.current;
  setLoading(true);
  setReports([]);
  setNextCursor(null);
  const qs = new URLSearchParams({ limit: "14" });
  if (filter !== "all") qs.set("type", filter);
  fetch(`/api/reports?${qs}`)
    .then((r) => r.json())
    .then((data) => {
      if (reqId !== requestIdRef.current) return;  // 더 새 요청이 있으면 폐기
      setReports(data.data ?? []);
      setNextCursor(data.nextCursor ?? null);
    })
    .finally(() => {
      if (reqId === requestIdRef.current) setLoading(false);
    });
}, [filter]);
```

더 보기:
```ts
async function loadMore() {
  if (!nextCursor || loadingMore) return;
  setLoadingMore(true);
  const reqId = requestIdRef.current;  // 현재 필터 컨텍스트 잠금
  try {
    const qs = new URLSearchParams({ limit: "14", cursor: nextCursor });
    if (filter !== "all") qs.set("type", filter);
    const res = await fetch(`/api/reports?${qs}`);
    const data = await res.json();
    if (reqId !== requestIdRef.current) return;  // 필터가 바뀌면 폐기
    setReports((prev) => [...prev, ...(data.data ?? [])]);
    setNextCursor(data.nextCursor ?? null);
  } finally {
    if (reqId === requestIdRef.current) setLoadingMore(false);
  }
}
```

필터 토글 UI (상단 액션 영역과 별도 줄):
```tsx
<div className="flex gap-1 mb-4">
  {[
    { value: "all", label: "전체" },
    { value: "morning", label: "모닝" },
    { value: "evening", label: "이브닝" },
    { value: "weekly", label: "주간" },
  ].map((f) => (
    <button
      key={f.value}
      onClick={() => setFilter(f.value as typeof filter)}
      className={`px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
        filter === f.value
          ? "bg-card border border-border-hover text-bright"
          : "border border-border text-sub hover:text-bright hover:border-border-hover"
      }`}
    >
      {f.label}
    </button>
  ))}
</div>
```

하단 더 보기 버튼 (`reports.length > 0 && nextCursor`):
```tsx
{nextCursor && (
  <div className="mt-4 text-center">
    <button
      onClick={loadMore}
      disabled={loadingMore}
      className="px-4 py-2 rounded-lg text-[12px] border border-border text-sub hover:text-bright hover:border-border-hover transition-colors disabled:opacity-50"
    >
      {loadingMore ? "불러오는 중..." : "더 보기"}
    </button>
  </div>
)}
```

`generate()` 후 새 리포트 추가 로직도 cursor 페이지네이션에 맞게 정정 — 현재는 `?days=14`로 다시 fetch하지만, 페이지네이션 환경에서는 첫 페이지를 새로 가져와 reports 초기화(누적 데이터가 사라지는 것은 OK — 사용자가 명시적으로 생성 액션 한 경우).

## 4. 변경 파일

- `src/app/api/reports/route.ts` — cursor/limit 파라미터, nextCursor 응답
- `src/app/reports/page.tsx` — **server component로 전환**, 첫 14건은 prisma 직접 조회 후 client에 props로 전달 (React 19 `react-hooks/set-state-in-effect` 룰 회피 + SSR 응답성 향상)
- `src/app/reports/reports-client.tsx` *(신규)* — 클라이언트 상호작용(필터/더 보기/생성/재생성/race-condition 가드) 담당
- (테스트 인프라 없음 — lint/typecheck/build로 정적 검증)

## 5. 테스트 계획

### 5.1 정적 검증

`npm run lint && npm run typecheck && npm run build` 3종 통과.

### 5.2 수동 검증 (로컬 dev 서버)

- 첫 로드 14건 표시, 더 보기 클릭으로 다음 14건 append
- 필터 변경 (예: 전체 → 주간) 시 reports 초기화 + 주간 리포트만 조회
- 더 보기로 한참 내려간 상태에서 필터 변경 시 — race condition으로 옛 데이터가 섞이지 않음
- nextCursor가 null이면 더 보기 버튼 사라짐 (전체 데이터 끝)
- `?date=2026-06-22` 단일 날짜 조회 호환 (cursor와 상호배타)
- 텔레그램 봇 `/report` 커맨드 등 기존 API 호출자 회귀 없음 (응답 envelope 확장은 추가만)

### 5.3 통합 검증

dev 서버에서 누적된 실제 리포트 데이터로 확인. 운영(main)은 머지 후 자동 적용.

## 6. 제외 사항

- 무한 스크롤 (IntersectionObserver) — "더 보기" 결정에서 제외
- 검색 기능 (전문 검색) — 사용 패턴 본 후 결정
- 리포트 CSV export — 현재 `/api/export` 가 있지만 리포트는 미포함, 추후 별도 이슈
- 페이지네이션 → URL state 동기화 (예: `?p=3`) — 별도 결정

## 7. 롤백

- `git revert <merge-sha>` 후 재빌드. DB 마이그레이션 없음.
- 응답 envelope 변경(`nextCursor` 추가)은 기존 호출자에게 영향 없음(추가 키 무시).
