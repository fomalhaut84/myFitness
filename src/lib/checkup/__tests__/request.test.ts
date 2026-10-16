// #527: API 입구 (검증 · 미래 날짜 · 행 빌드) · 응답 정렬 · findings 방어 · 로그에 건강 데이터 미기록. 값은 가상.
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prepareCheckupWrite } from "../request";
import { sortResults, toFindings } from "../dto";
import { describeError } from "../write";

const TODAY = "2025-10-16";

describe("prepareCheckupWrite", () => {
  const body = {
    date: "2025-06-11",
    kind: "comprehensive",
    results: [
      { label: "LDL", value: "120", ref: "0-129" },
      { label: "AST", value: "25" },
    ],
  };

  it("정상 입력 → 행 2개", () => {
    const res = prepareCheckupWrite(body, TODAY);
    expect(res.ok && res.rows.map((r) => r.itemCode)).toEqual(["ldl", "ast"]);
  });

  it("본문 없음 · 형식 오류 → 400 + issues", () => {
    const res = prepareCheckupWrite(null, TODAY);
    expect(res).toMatchObject({ ok: false, status: 400, body: { error: "유효하지 않은 입력" } });
  });

  it("미래 검진일 → 400 (오늘은 허용)", () => {
    expect(prepareCheckupWrite({ ...body, date: "2025-10-17" }, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(prepareCheckupWrite({ ...body, date: TODAY }, TODAY).ok).toBe(true);
  });

  it("같은 항목 중복 → 400 (빌드 에러 메시지)", () => {
    const res = prepareCheckupWrite({ ...body, results: [...body.results, { label: "SGOT", value: "26" }] }, TODAY);
    expect(res).toMatchObject({ ok: false, status: 400, body: { error: "같은 항목이 두 번 입력됐습니다: AST · SGOT" } });
  });
});

describe("sortResults", () => {
  it("섹션 순서 → 카탈로그 순서 → 카탈로그 밖 이름순 · 원본 불변", () => {
    const input = [
      { category: "기타", itemCode: "custom:b", label: "나" },
      { category: "지질", itemCode: "ldl", label: "LDL" },
      { category: "혈압", itemCode: "sbp", label: "수축기" },
      { category: "지질", itemCode: "tc", label: "총콜" },
      { category: "기타", itemCode: "custom:a", label: "가" },
      { category: "가상분류", itemCode: "custom:c", label: "다" },
    ];
    const snapshot = JSON.stringify(input);
    expect(sortResults(input).map((r) => r.itemCode)).toEqual(["sbp", "tc", "ldl", "custom:c", "custom:a", "custom:b"]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("toFindings", () => {
  it("배열이 아니거나 형태가 어긋난 원소는 버린다", () => {
    expect(toFindings(null)).toEqual([]);
    expect(toFindings({})).toEqual([]);
    expect(toFindings([{ category: "지질", text: "가상 소견" }, { text: "분류 없음" }, 3, null])).toEqual([
      { category: "지질", text: "가상 소견", flag: null },
    ]);
  });
});

describe("describeError", () => {
  it("Prisma 에러는 종류 · 코드만 (메시지에 입력 값이 실릴 수 있다)", () => {
    const known = new Prisma.PrismaClientKnownRequestError("가상 값 123 포함 메시지", { code: "P2002", clientVersion: "x" });
    expect(describeError(known)).toBe("PrismaKnown P2002");
    const validation = new Prisma.PrismaClientValidationError("valueNum: 123", { clientVersion: "x" });
    expect(describeError(validation)).toBe("PrismaClientValidationError");
    const unknown = new Prisma.PrismaClientUnknownRequestError("Failing row contains (가상 123)", { clientVersion: "x" });
    expect(describeError(unknown)).toBe("PrismaClientUnknownRequestError");
  });

  it("그 외 에러는 이름 + 메시지", () => {
    expect(describeError(new TypeError("boom"))).toBe("TypeError: boom");
    expect(describeError("x")).toBe("string");
  });
});
