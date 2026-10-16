// #532: 결과지 추출 → 확인 → 저장 계획 (순수). 값 · 날짜 · 기관명은 전부 가상.
import { describe, expect, it } from "vitest";
import { parseExtractResponse, type ExtractedPage } from "../import/extract-schema";
import { mergePages } from "../import/merge";
import { buildDraftRounds, duplicateRows, matchExtracted, newItemCode, type DraftRound, type DraftRow } from "../import/draft";
import { followUpDueFrom } from "../import/follow-up";
import { applyExistingDefaults, rowStatus, sameValue, type ExistingRound } from "../import/status";
import { assembleImport, blockingReasons, effectiveRounds } from "../import/assemble";
import { prepareImport } from "../import/request";
import { mergeResultRow, planRound, type StoredResult } from "../import/plan";

const TODAY = "2033-01-01";

const page = (over: Partial<ExtractedPage> = {}): ExtractedPage => ({ institution: null, examDate: null, sections: [], items: [], ...over });
const item = (label: string, value: string, over: Partial<ExtractedPage["items"][number]> = {}): ExtractedPage["items"][number] => ({
  section: null,
  label,
  value,
  unit: null,
  ref: null,
  flag: null,
  note: null,
  followUp: null,
  past: [],
  ...over,
});

describe("parseExtractResponse", () => {
  const body = {
    institution: "가상검진센터",
    examDate: null,
    sections: [{ category: "가상 분류", findings: ["가상 소견"] }],
    items: [{ section: "가상 분류", label: "AST", value: "12", ref: "0-40", flag: "caution", past: [{ date: "2030-01-02", dateText: null, value: "11" }] }],
  };

  it("정상 응답 · 누락 필드는 null / 빈 배열", () => {
    const p = parseExtractResponse(JSON.stringify(body));
    expect(p?.items[0]).toMatchObject({ label: "AST", value: "12", unit: null, note: null, flag: "caution" });
    expect(p?.items[0].past).toEqual([{ date: "2030-01-02", dateText: null, value: "11" }]);
  });

  it("코드펜스 · 앞뒤 문장이 붙어도 JSON 부분만", () => {
    expect(parseExtractResponse("결과입니다\n```json\n" + JSON.stringify(body) + "\n```")?.items).toHaveLength(1);
  });

  it("실제 날짜가 아닌 과거 날짜는 null 로 남기고 (원문 표기 보존) · 실제 날짜 아닌 검진일은 null", () => {
    const p = parseExtractResponse(
      JSON.stringify({ ...body, examDate: "2030-02-30", items: [{ ...body.items[0], past: [{ date: "30.01.02", dateText: "30.01.02", value: "1" }] }] }),
    );
    expect(p?.examDate).toBeNull();
    expect(p?.items[0].past).toEqual([{ date: null, dateText: "30.01.02", value: "1" }]);
  });

  it("길이 초과 · 배열 상한 · JSON 아님 · 필수 누락은 null", () => {
    expect(parseExtractResponse(JSON.stringify({ items: [{ label: "x".repeat(101), value: "1" }] }))).toBeNull();
    expect(parseExtractResponse(JSON.stringify({ items: Array.from({ length: 151 }, () => ({ label: "a", value: "1" })) }))).toBeNull();
    expect(parseExtractResponse("항목이 없습니다")).toBeNull();
    expect(parseExtractResponse(JSON.stringify({ items: [{ label: "AST" }] }))).toBeNull();
  });

  it("빈 결과지 쪽은 items 빈 배열", () => {
    expect(parseExtractResponse("{}")?.items).toEqual([]);
  });
});

describe("mergePages", () => {
  it("겹친 행은 하나로 · 다른 값이면 충돌 · 과거 날짜 합침", () => {
    const merged = mergePages([
      page({ items: [item("AST", "12", { past: [{ date: "2030-01-02", dateText: null, value: "11" }] })] }),
      page({ institution: "가상검진센터", items: [item("AST", "13", { ref: "0-40", past: [{ date: "2028-01-02", dateText: null, value: "10" }] }), item("ALT", "20")] }),
    ]);
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0]).toMatchObject({ value: "12", ref: "0-40", conflict: true, pages: [0, 1] });
    expect(merged.items[0].past.map((p) => p.date)).toEqual(["2030-01-02", "2028-01-02"]);
    expect(merged.institution).toBe("가상검진센터");
  });

  it("공백만 다른 값은 같은 값 · 섹션이 다르면 다른 행", () => {
    const merged = mergePages([
      page({ items: [item("WBC", "1 - 2", { section: "소변" })] }),
      page({ items: [item("WBC", "1-2", { section: "소변" }), item("WBC", "6.0", { section: "혈액" })] }),
    ]);
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0].conflict).toBe(false);
  });

  it("쪽마다 다른 검진일은 첫 값 + 충돌 표시 · 소견 중복 제거", () => {
    const merged = mergePages([
      page({ examDate: "2030-01-02", sections: [{ category: "가", findings: ["소견 1"] }] }),
      page({ examDate: "2030-01-03", sections: [{ category: "가", findings: ["소견 1", "소견 2"] }] }),
    ]);
    expect(merged.examDate).toBe("2030-01-02");
    expect(merged.examDateConflict).toBe(true);
    expect(merged.sections).toEqual([{ category: "가", findings: ["소견 1", "소견 2"] }]);
  });
});

describe("matchExtracted", () => {
  it("정확 일치 · 부기 제거 일치 · 카탈로그 밖", () => {
    expect(matchExtracted("AST", null)).toEqual({ itemCode: "ast", confidence: "exact" });
    expect(matchExtracted("AST(SGOT)", null)).toEqual({ itemCode: "ast", confidence: "exact" });
    expect(matchExtracted("총콜레스테롤(T-Chol)", null)).toEqual({ itemCode: "tc", confidence: "fuzzy" });
    expect(matchExtracted("가상검사항목", null)).toEqual({ itemCode: "custom:가상검사항목", confidence: "none" });
  });

  it("소변 섹션의 WBC 는 혈액 백혈구가 아니라 소변 항목 (확인 표시)", () => {
    expect(matchExtracted("WBC", "소변검사")).toEqual({ itemCode: "urine_wbc", confidence: "fuzzy" });
    expect(matchExtracted("WBC", "요침사")).toEqual({ itemCode: "urine_sed_wbc", confidence: "fuzzy" });
    expect(matchExtracted("WBC", "혈액검사")).toEqual({ itemCode: "wbc", confidence: "exact" });
    // 이름만으로는 카탈로그에 없지만 소변 한정자를 붙이면 있는 항목
    expect(matchExtracted("빌리루빈", "소변검사")).toEqual({ itemCode: "urine_bilirubin", confidence: "fuzzy" });
    expect(matchExtracted("빌리루빈", null).confidence).toBe("none");
  });

  it("새 항목 code 가 카탈로그 이름과 겹치면 섹션을 붙인다", () => {
    expect(newItemCode("WBC", "가상")).toBe("custom:가상wbc");
    expect(newItemCode("※", null)).toBeNull();
  });
});

describe("buildDraftRounds · duplicateRows", () => {
  const merged = mergePages([
    page({
      examDate: "2032-04-20",
      items: [
        item("AST", "12", { ref: "0-40", flag: "caution", past: [{ date: "2030-01-02", dateText: null, value: "11" }, { date: "2028-01-02", dateText: null, value: "10" }] }),
        item("ALT", "20", { past: [{ date: "2030-01-02", dateText: null, value: "19" }] }),
      ],
    }),
  ]);
  const rounds = buildDraftRounds(merged, TODAY);

  it("금회 + 과거 날짜별 회차 (최근 순) · 과거 값은 판정 · 기준범위 없이", () => {
    expect(rounds.map((r) => r.key)).toEqual(["current", "2030-01-02", "2028-01-02"]);
    expect(rounds[0].date).toBe("2032-04-20");
    expect(rounds[1].rows.map((r) => [r.itemCode, r.value, r.ref, r.flag])).toEqual([
      ["ast", "11", null, null],
      ["alt", "19", null, null],
    ]);
  });

  it("같은 itemCode 로 매칭된 뒤 행만 표시 · 제외한 행은 무시", () => {
    const rows = [
      { ...rounds[0].rows[0], key: "a", label: "AST" },
      { ...rounds[0].rows[0], key: "b", label: "SGOT" },
      { ...rounds[0].rows[0], key: "c", label: "GOT", include: false },
    ];
    expect([...duplicateRows(rows)]).toEqual([["b", "AST"]]);
  });
});

describe("followUpDueFrom", () => {
  it("개월 · 년 · 주 · 범위는 짧은 쪽", () => {
    expect(followUpDueFrom("12개월 후 추적검사", "2030-03-15")).toBe("2031-03-15");
    expect(followUpDueFrom("1년 뒤 재검", "2030-03-15")).toBe("2031-03-15");
    expect(followUpDueFrom("2주 후 재검", "2030-03-15")).toBe("2030-03-29");
    expect(followUpDueFrom("6~12개월 후 추적", "2030-03-15")).toBe("2030-09-15");
  });

  it("월말은 그 달 마지막 날 · 해석 불가 · 검진일 없음은 null", () => {
    expect(followUpDueFrom("1개월 후", "2030-01-31")).toBe("2030-02-28");
    expect(followUpDueFrom("전문의 상담 권유", "2030-01-31")).toBeNull();
    expect(followUpDueFrom("12개월 후", null)).toBeNull();
    expect(followUpDueFrom("0개월", "2030-01-31")).toBeNull();
  });
});

const row = (over: Partial<DraftRow>): DraftRow => ({
  key: "k",
  label: "AST",
  section: null,
  value: "12",
  unit: null,
  ref: null,
  flag: null,
  note: null,
  followUp: null,
  followUpDue: null,
  itemCode: "ast",
  confidence: "exact",
  conflict: false,
  include: true,
  overwrite: false,
  ...over,
});

describe("rowStatus · applyExistingDefaults", () => {
  const existing: ExistingRound = {
    id: "x",
    date: "2030-01-02",
    results: [
      { itemCode: "ast", valueNum: 12.3, valueText: "12.30", unit: null },
      { itemCode: "alt", valueNum: null, valueText: "음 성", unit: null },
    ],
  };

  it("new · same (수치 · 공백 무시) · different", () => {
    expect(rowStatus(row({ itemCode: "ggt" }), existing).status).toBe("new");
    expect(rowStatus(row({ value: "12.3" }), existing).status).toBe("same");
    expect(sameValue("음성", existing.results[1])).toBe(true);
    expect(rowStatus(row({ value: "13" }), existing).status).toBe("different");
    expect(rowStatus(row({}), null).status).toBe("new");
  });

  it("같은 값은 빼고 · 값 다름은 포함하되 덮어쓰기 꺼짐", () => {
    const round: DraftRound = {
      key: "2030-01-02",
      current: false,
      date: "2030-01-02",
      dateText: null,
      needsDate: false,
      rows: [row({ key: "a", value: "12.3" }), row({ key: "b", value: "13", overwrite: true }), row({ key: "c", itemCode: "ggt" })],
    };
    const out = applyExistingDefaults(round, existing).rows;
    expect(out.map((r) => [r.include, r.overwrite])).toEqual([
      [false, false],
      [true, false],
      [true, false],
    ]);
  });
});

describe("assembleImport", () => {
  const rounds: DraftRound[] = [
    {
      key: "current",
      current: true,
      date: null,
      dateText: null,
      needsDate: false,
      rows: [row({ key: "c1", followUp: "6개월 후" }), row({ key: "c2", itemCode: "alt", label: "ALT", followUp: "12개월 후", followUpDue: "2031-01-02" })],
    },
    { key: "2030-01-02", current: false, date: "2030-01-02", dateText: null, needsDate: false, rows: [row({ key: "p1", value: "11" }), row({ key: "p2", itemCode: "ggt", label: "GGT", value: "30" })] },
    { key: "2028-01-02", current: false, date: "2028-01-02", dateText: null, needsDate: false, rows: [row({ key: "q1", include: false })] },
  ];
  const header = { date: "", institution: " 가상검진센터 ", kind: "comprehensive" as const };

  it("금회 검진일이 없으면 막는다", () => {
    expect(blockingReasons({ today: TODAY, header, rounds })).toContain("금회 검진일을 입력하세요");
  });

  it("금회 날짜가 과거 회차와 같으면 금회에 없는 항목만 합친다", () => {
    const eff = effectiveRounds(rounds, "2030-01-02");
    expect(eff.map((r) => r.date)).toEqual(["2030-01-02", "2028-01-02"]);
    expect(eff[0].rows.map((r) => r.itemCode)).toEqual(["ast", "alt", "ggt"]);
  });

  it("본문: 포함한 행 · 빈 회차 제외 · 금회만 소견 · 기관 trim", () => {
    const res = assembleImport({
      today: TODAY,
      source: "capture",
      header: { ...header, date: "2032-04-20" },
      rounds,
      findings: [
        { key: "f1", category: "가", text: "소견", include: true },
        { key: "f2", category: "가", text: "뺀 소견", include: false },
      ],
      pages: [],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.rounds.map((r) => [r.date, r.results.length, r.findings?.length ?? null, r.institution])).toEqual([
      ["2032-04-20", 2, 1, "가상검진센터"],
      ["2030-01-02", 2, null, "가상검진센터"],
    ]);
    // 사용자가 고른 예정일 우선 · 없으면 권고 원문 + 금회 검진일
    expect(res.body.rounds[0].results[1]).toMatchObject({ itemCode: "alt", followUpDue: "2031-01-02", overwrite: false });
    expect(res.body.rounds[0].results[0].followUpDue).toBe("2032-10-20");
  });

  it("중복 매칭 · 항목 없는 행은 막는다", () => {
    const bad: DraftRound[] = [{ key: "current", current: true, date: null, dateText: null, needsDate: false, rows: [row({ key: "a" }), row({ key: "b" }), row({ key: "c", itemCode: null })] }];
    const reasons = blockingReasons({ today: TODAY, header: { ...header, date: "2032-04-20" }, rounds: bad });
    expect(reasons).toEqual(["같은 항목으로 매칭된 행 1개를 정리하세요", "항목을 알아볼 수 없는 행 1개를 빼거나 매칭하세요"]);
  });
});

describe("prepareImport", () => {
  const result = { itemCode: "ast", label: "AST", value: "12" };
  const body = (rounds: unknown[]) => ({ source: "capture", rounds });

  it("회차별 행 + overwrite 보존 · 기본 false", () => {
    const p = prepareImport(body([{ date: "2030-01-02", kind: "comprehensive", results: [{ ...result, overwrite: true }, { itemCode: "alt", label: "ALT", value: "20" }] }]), "2032-01-01");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.rounds[0].rows.map((r) => [r.itemCode, r.overwrite])).toEqual([
      ["ast", true],
      ["alt", false],
    ]);
  });

  it("미래 날짜 · 날짜 중복 · 회차 안 같은 항목 · 상한 · 알 수 없는 source 거부", () => {
    expect(prepareImport(body([{ date: "2033-01-02", kind: "other", results: [result] }]), "2032-01-01").ok).toBe(false);
    const dup = { date: "2030-01-02", kind: "other", results: [result] };
    expect(prepareImport(body([dup, dup]), "2032-01-01").ok).toBe(false);
    expect(prepareImport(body([{ ...dup, results: [result, { ...result, label: "SGOT" }] }]), "2032-01-01").ok).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...dup, date: `2030-01-${String(i + 1).padStart(2, "0")}` }));
    expect(prepareImport(body(many), "2032-01-01").ok).toBe(false);
    const big = Array.from({ length: 3 }, (_, i) => ({ ...dup, date: `2030-01-0${i + 1}`, results: Array.from({ length: 201 }, (_, j) => ({ ...result, itemCode: `custom:x${j}`, label: `x${j}` })) }));
    expect(prepareImport(body(big), "2032-01-01").ok).toBe(false);
    expect(prepareImport({ source: "manual", rounds: [dup] }, "2032-01-01").ok).toBe(false);
  });
});

describe("planRound", () => {
  const prepared = prepareImport(
    {
      source: "pdf",
      rounds: [
        {
          date: "2030-01-02",
          kind: "comprehensive",
          findings: [{ category: "가", text: "소견" }],
          results: [
            { itemCode: "ast", label: "AST", value: "12" },
            { itemCode: "alt", label: "ALT", value: "20", overwrite: true },
            { itemCode: "ggt", label: "GGT", value: "30" },
          ],
        },
      ],
    },
    "2032-01-01",
  );
  if (!prepared.ok) throw new Error("fixture");
  const round = prepared.rounds[0];

  it("새 회차는 전부 추가 · 소견 채움", () => {
    const plan = planRound(round, null);
    expect([plan.existingId, plan.add.length, plan.replace.length, plan.skipped, plan.fillFindings]).toEqual([null, 3, 0, 0, true]);
  });

  const stored = (itemCode: string, over: Partial<StoredResult> = {}): StoredResult => ({
    id: `id-${itemCode}`,
    itemCode,
    valueNum: 1,
    valueText: "1",
    unit: "U/L",
    refText: null,
    refLow: null,
    refHigh: null,
    flag: null,
    flagSource: null,
    note: null,
    followUp: null,
    followUpDue: null,
    ...over,
  });

  it("기존 회차: 없는 항목 추가 · overwrite 만 병합 · 나머지 건너뜀 · 소견은 비었을 때만", () => {
    const plan = planRound(round, { id: "x", hasFindings: true, results: new Map([["ast", stored("ast")], ["alt", stored("alt")]]) });
    expect(plan.add.map((r) => r.itemCode)).toEqual(["ggt"]);
    expect(plan.replace.map((r) => [r.id, r.itemCode, r.previous.valueText])).toEqual([["id-alt", "alt", "1"]]);
    expect(plan.skipped).toBe(1);
    expect(plan.fillFindings).toBe(false);
  });
});

// 회귀: 덮어쓰기가 행을 교체해 과거결과 열 값 (값만 있음) 이 그 회차의 기준범위 · 판정 · 판독문 · 추적 예정일을 지웠다
// → 결과지가 준 필드만 바꾸는 병합 (2026-10-16 사용자 결정)
describe("mergeResultRow", () => {
  const stored: StoredResult = {
    id: "s",
    itemCode: "alt",
    valueNum: 50,
    valueText: "50",
    unit: "U/L",
    refText: "0-40",
    refLow: 0,
    refHigh: 40,
    flag: "abnormal",
    flagSource: "computed",
    note: "가상 메모",
    followUp: "6개월 후",
    followUpDue: new Date("2030-07-01T15:00:00Z"),
  };
  const incoming = (results: Record<string, unknown>) => {
    const p = prepareImport({ source: "photo", rounds: [{ date: "2030-01-02", kind: "other", results: [{ itemCode: "alt", label: "ALT", overwrite: true, ...results }] }] }, "2032-01-01");
    if (!p.ok) throw new Error("fixture");
    return p.rounds[0].rows[0];
  };

  it("과거결과 열 (값만): 값만 바꾸고 단위 · 기준범위 · 판독문 · 추적은 유지 · 계산 판정은 새 값으로 다시", () => {
    const m = mergeResultRow(stored, incoming({ value: "30" }));
    expect(m).toMatchObject({ valueNum: 30, valueText: "30", unit: "U/L", refText: "0-40", note: "가상 메모", followUp: "6개월 후" });
    expect(m.followUpDue).toEqual(stored.followUpDue);
    expect([m.flag, m.flagSource]).toEqual(["normal", "computed"]);
  });

  it("저장된 기관 판정은 유지 · 결과지 판정이 있으면 그것", () => {
    const inst = { ...stored, flag: "caution", flagSource: "institution" };
    expect(mergeResultRow(inst, incoming({ value: "30" })).flag).toBe("caution");
    expect(mergeResultRow(inst, incoming({ value: "30", flag: "abnormal" }))).toMatchObject({ flag: "abnormal", flagSource: "institution" });
  });

  it("금회 열 (필드 있음): 준 필드는 결과지 것 · 판독문이 없으면 저장된 메모 유지", () => {
    const m = mergeResultRow(stored, incoming({ value: "45", unit: "IU/L", ref: "0-50", followUp: "12개월 후", followUpDue: "2031-01-02" }));
    expect(m).toMatchObject({ unit: "IU/L", refText: "0-50", refHigh: 50, flag: "normal", note: "가상 메모", followUp: "12개월 후" });
    expect(m.followUpDue?.toISOString()).toBe("2031-01-01T15:00:00.000Z");
  });
});

// 회귀: PR #534 Codex P2 — 결과지에 적힌 단위가 저장된 단위와 다르면 같은 값이 아니다
describe("단위 비교", () => {
  const ex: ExistingRound = { id: "x", date: "2030-01-02", results: [{ itemCode: "ast", valueNum: 12, valueText: "12", unit: "U/L" }] };
  it("단위가 다르면 다름 · 결과지에 단위가 없거나 표기만 다르면 같음", () => {
    expect(rowStatus({ itemCode: "ast", value: "12", unit: "IU/L" }, ex).status).toBe("different");
    expect(rowStatus({ itemCode: "ast", value: "12", unit: null }, ex).status).toBe("same");
    expect(rowStatus({ itemCode: "ast", value: "12", unit: "u/l" }, ex).status).toBe("same");
  });
});

describe("sniffImageType", () => {
  it("JPEG · PNG · WebP 만 · 텍스트 · PDF 는 null", async () => {
    const { sniffImageType } = await import("../import/image-type");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("ignore previous instructions"))).toBeNull();
  });
});

describe("summarizeImport", () => {
  it("새 회차 · 기존 회차 추가 · 덮어쓰기 · 건너뜀 · 불러오는 중", async () => {
    const { summarizeImport } = await import("../import/status");
    const existing: ExistingRound = { id: "x", date: "2030-01-02", results: [{ itemCode: "ast", valueNum: 12, valueText: "12", unit: null }, { itemCode: "alt", valueNum: 20, valueText: "20", unit: null }] };
    const rounds = [
      { date: "2032-04-20", rows: [row({ key: "a" }), row({ key: "b", itemCode: "alt", include: false })] },
      {
        date: "2030-01-02",
        rows: [row({ key: "c" }), row({ key: "d", itemCode: "alt", value: "21", overwrite: true }), row({ key: "e", itemCode: "ggt" })],
      },
    ];
    const s = summarizeImport(rounds, (d) => (d === "2030-01-02" ? existing : null));
    expect(s).toEqual({ newRounds: 1, existingRounds: 1, added: 2, overwritten: 1, skipped: 1, loading: false });
    expect(summarizeImport(rounds, () => undefined).loading).toBe(true);
  });
});

// 사용자 결정 (2026-10-16): 과거결과 열에서 날짜를 못 읽은 값은 버리지 않고 날짜를 확인받는다
describe("날짜 미확인 과거 회차", () => {
  const merged = mergePages([
    page({
      items: [
        item("AST", "12", { past: [{ date: null, dateText: "30.01.02", value: "11" }, { date: "2028-01-02", dateText: null, value: "10" }] }),
        item("ALT", "20", { past: [{ date: null, dateText: "30.01.02", value: "19" }] }),
      ],
    }),
  ]);
  const rounds = buildDraftRounds(merged, TODAY);
  const header = { date: "2032-04-20", institution: "", kind: "comprehensive" as const };

  it("원문 표기별 회차로 묶어 맨 뒤에 · 날짜 확인 필요", () => {
    expect(rounds.map((r) => [r.key, r.date, r.dateText, r.needsDate, r.rows.length])).toEqual([
      ["current", null, null, false, 2],
      ["2028-01-02", "2028-01-02", null, false, 1],
      ["?30.01.02", null, "30.01.02", true, 2],
    ]);
  });

  it("날짜를 넣기 전에는 저장을 막고, 넣으면 그 날짜 회차로 저장", () => {
    expect(blockingReasons({ today: TODAY, header, rounds })).toEqual(["날짜를 확인하지 않은 과거 회차 1개 — 날짜를 넣거나 행을 빼세요"]);
    const dated = rounds.map((r) => (r.needsDate ? { ...r, date: "2030-01-02" } : r));
    const res = assembleImport({ today: TODAY, source: "photo", header, rounds: dated, findings: [], pages: [] });
    expect(res.ok && res.body.rounds.map((r) => [r.date, r.results.length])).toEqual([
      ["2032-04-20", 2],
      ["2028-01-02", 1],
      ["2030-01-02", 2],
    ]);
  });

  it("행을 모두 빼면 날짜 없이도 저장 가능", () => {
    const off = rounds.map((r) => (r.needsDate ? { ...r, rows: r.rows.map((x) => ({ ...x, include: false })) } : r));
    expect(blockingReasons({ today: TODAY, header, rounds: off })).toEqual([]);
  });

  it("다른 회차와 같은 날짜를 넣으면 그 회차에 없는 항목만 합친다", () => {
    const same = rounds.map((r) => (r.needsDate ? { ...r, date: "2028-01-02" } : r));
    const eff = effectiveRounds(same, header.date);
    expect(eff.map((r) => [r.date, r.rows.map((x) => x.itemCode)])).toEqual([
      ["2032-04-20", ["ast", "alt"]],
      ["2028-01-02", ["ast", "alt"]],
    ]);
  });
});

// 회귀: PR 전 리뷰 major 1 — 날짜를 바꾸면 이전 날짜의 기본값 (같은 값이라 뺀 행) 이 남지 않는다
describe("applyExistingDefaults — 날짜 변경", () => {
  it("기존 회차 A 에서 뺀 행이 기존 회차 없는 B 에서 다시 포함된다", () => {
    const a: ExistingRound = { id: "a", date: "2030-01-02", results: [{ itemCode: "ast", valueNum: 12, valueText: "12", unit: null }] };
    const round: DraftRound = { key: "current", current: true, date: null, dateText: null, needsDate: false, rows: [row({ key: "r", value: "12" })] };
    const onA = applyExistingDefaults(round, a);
    expect(onA.rows[0].include).toBe(false);
    expect(applyExistingDefaults(onA, null).rows[0].include).toBe(true);
    expect(applyExistingDefaults({ ...onA, rows: [row({ key: "n", itemCode: null, include: false })] }, null).rows[0].include).toBe(false);
  });
});

// 회귀: PR 전 리뷰 major 3 — 미래로 읽힌 과거 날짜는 날짜 확인 필요 · 미래 날짜 회차는 저장 전에 막는다
describe("미래 날짜", () => {
  it("과거결과 열의 오늘 이후 날짜는 날짜 확인 필요 회차 (원문 보존)", () => {
    const merged = mergePages([page({ items: [item("AST", "12", { past: [{ date: "2040-01-02", dateText: null, value: "11" }] })] })]);
    const past = buildDraftRounds(merged, TODAY)[1];
    expect([past.date, past.dateText, past.needsDate]).toEqual([null, "2040-01-02", true]);
  });

  it("금회 · 과거 회차 날짜가 오늘 이후면 막는다", () => {
    const rounds: DraftRound[] = [
      { key: "current", current: true, date: null, dateText: null, needsDate: false, rows: [row({ key: "a" })] },
      { key: "?x", current: false, date: "2034-01-01", dateText: "x", needsDate: true, rows: [row({ key: "b", itemCode: "alt" })] },
    ];
    expect(blockingReasons({ today: TODAY, header: { date: "2033-05-05", institution: "", kind: "other" }, rounds })).toEqual([
      "오늘 이후 날짜의 회차 2개 — 날짜를 고치세요",
    ]);
  });
});

// 회귀: PR #534 Codex P1 — 겹친 쪽의 같은 과거 날짜 값이 다르면 조용히 버리지 않고 충돌로 표시
describe("과거 값 충돌", () => {
  it("같은 항목 · 같은 과거 날짜가 쪽마다 다르면 그 회차 행에 충돌", () => {
    const merged = mergePages([
      page({ items: [item("AST", "12", { past: [{ date: "2030-01-02", dateText: null, value: "11" }, { date: "2028-01-02", dateText: null, value: "10" }] })] }),
      page({ items: [item("AST", "12", { past: [{ date: "2030-01-02", dateText: null, value: "17" }, { date: "2028-01-02", dateText: null, value: "1 0" }] })] }),
    ]);
    expect(merged.items[0].conflict).toBe(false);
    expect(merged.items[0].pastConflicts).toEqual(["2030-01-02"]);
    const rounds = buildDraftRounds(merged, TODAY);
    expect(rounds.slice(1).map((r) => [r.date, r.rows[0].value, r.rows[0].conflict])).toEqual([
      ["2030-01-02", "11", true],
      ["2028-01-02", "10", false],
    ]);
  });
});
