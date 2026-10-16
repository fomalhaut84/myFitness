// #532: 결과지 추출 → 확인 → 저장 계획 (순수). 값 · 날짜 · 기관명은 전부 가상.
import { describe, expect, it } from "vitest";
import { parseExtractResponse, type ExtractedPage } from "../import/extract-schema";
import { mergePages } from "../import/merge";
import { buildDraftRounds, duplicateRows, matchExtracted, newItemCode, type DraftRound, type DraftRow } from "../import/draft";
import { followUpDueFrom } from "../import/follow-up";
import { applyExistingDefaults, rowStatus, sameValue, type ExistingRound } from "../import/status";
import { assembleImport, blockingReasons, effectiveRounds } from "../import/assemble";
import { prepareImport } from "../import/request";
import { planRound } from "../import/plan";

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
    items: [{ section: "가상 분류", label: "AST", value: "12", ref: "0-40", flag: "caution", past: [{ date: "2030-01-02", value: "11" }] }],
  };

  it("정상 응답 · 누락 필드는 null / 빈 배열", () => {
    const p = parseExtractResponse(JSON.stringify(body));
    expect(p?.items[0]).toMatchObject({ label: "AST", value: "12", unit: null, note: null, flag: "caution" });
    expect(p?.items[0].past).toEqual([{ date: "2030-01-02", value: "11" }]);
  });

  it("코드펜스 · 앞뒤 문장이 붙어도 JSON 부분만", () => {
    expect(parseExtractResponse("결과입니다\n```json\n" + JSON.stringify(body) + "\n```")?.items).toHaveLength(1);
  });

  it("실제 날짜가 아닌 과거 날짜는 버리고, 실제 날짜 아닌 검진일은 null", () => {
    const p = parseExtractResponse(
      JSON.stringify({ ...body, examDate: "2030-02-30", items: [{ ...body.items[0], past: [{ date: "30.01.02", value: "1" }] }] }),
    );
    expect(p?.examDate).toBeNull();
    expect(p?.items[0].past).toEqual([]);
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
      page({ items: [item("AST", "12", { past: [{ date: "2030-01-02", value: "11" }] })] }),
      page({ institution: "가상검진센터", items: [item("AST", "13", { ref: "0-40", past: [{ date: "2028-01-02", value: "10" }] }), item("ALT", "20")] }),
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
        item("AST", "12", { ref: "0-40", flag: "caution", past: [{ date: "2030-01-02", value: "11" }, { date: "2028-01-02", value: "10" }] }),
        item("ALT", "20", { past: [{ date: "2030-01-02", value: "19" }] }),
      ],
    }),
  ]);
  const rounds = buildDraftRounds(merged);

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
      { itemCode: "ast", valueNum: 12.3, valueText: "12.30" },
      { itemCode: "alt", valueNum: null, valueText: "음 성" },
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
    { key: "current", current: true, date: null, rows: [row({ key: "c1" }), row({ key: "c2", itemCode: "alt", label: "ALT", followUp: "12개월 후", followUpDue: "2031-01-02" })] },
    { key: "2030-01-02", current: false, date: "2030-01-02", rows: [row({ key: "p1", value: "11" }), row({ key: "p2", itemCode: "ggt", label: "GGT", value: "30" })] },
    { key: "2028-01-02", current: false, date: "2028-01-02", rows: [row({ key: "q1", include: false })] },
  ];
  const header = { date: "", institution: " 가상검진센터 ", kind: "comprehensive" as const };

  it("금회 검진일이 없으면 막는다", () => {
    expect(blockingReasons({ header, rounds })).toContain("금회 검진일을 입력하세요");
  });

  it("금회 날짜가 과거 회차와 같으면 금회에 없는 항목만 합친다", () => {
    const eff = effectiveRounds(rounds, "2030-01-02");
    expect(eff.map((r) => r.date)).toEqual(["2030-01-02", "2028-01-02"]);
    expect(eff[0].rows.map((r) => r.itemCode)).toEqual(["ast", "alt", "ggt"]);
  });

  it("본문: 포함한 행 · 빈 회차 제외 · 금회만 소견 · 기관 trim", () => {
    const res = assembleImport({
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
    expect(res.body.rounds[0].results[1]).toMatchObject({ itemCode: "alt", followUpDue: "2031-01-02", overwrite: false });
  });

  it("중복 매칭 · 항목 없는 행은 막는다", () => {
    const bad: DraftRound[] = [{ key: "current", current: true, date: null, rows: [row({ key: "a" }), row({ key: "b" }), row({ key: "c", itemCode: null })] }];
    const reasons = blockingReasons({ header: { ...header, date: "2032-04-20" }, rounds: bad });
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

  it("기존 회차: 없는 항목 추가 · overwrite 만 교체 · 나머지 건너뜀 · 소견은 비었을 때만", () => {
    const plan = planRound(round, { id: "x", hasFindings: true, itemCodes: new Set(["ast", "alt"]) });
    expect(plan.add.map((r) => r.itemCode)).toEqual(["ggt"]);
    expect(plan.replace.map((r) => r.itemCode)).toEqual(["alt"]);
    expect(plan.skipped).toBe(1);
    expect(plan.fillFindings).toBe(false);
  });
});
