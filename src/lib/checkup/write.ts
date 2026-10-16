// #527: 검진 저장 (prisma). 회차 + 결과는 한 트랜잭션 — 수정은 결과 전체 교체 (스펙 §4 A2).
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { parseDateOnlyKST } from "@/lib/date-input";
import type { CheckupResultRow } from "./build";
import type { CheckupInput } from "./schema";

function checkupData(input: CheckupInput) {
  return {
    date: parseDateOnlyKST(input.date),
    institution: input.institution ?? null,
    kind: input.kind,
    source: input.source,
    summary: input.summary ?? null,
    // Json? 컬럼을 비울 때는 DbNull (undefined 는 "변경 없음")
    findings: input.findings && input.findings.length > 0 ? input.findings : Prisma.DbNull,
  };
}

export async function createCheckup(input: CheckupInput, rows: readonly CheckupResultRow[]): Promise<{ id: string }> {
  return prisma.healthCheckup.create({
    data: { ...checkupData(input), results: { createMany: { data: [...rows] } } },
    select: { id: true },
  });
}

/** 없는 id 는 P2025 (트랜잭션 롤백 — 결과 삭제도 되돌아간다). */
export async function replaceCheckup(
  id: string,
  input: CheckupInput,
  rows: readonly CheckupResultRow[],
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.checkupResult.deleteMany({ where: { checkupId: id } });
    return tx.healthCheckup.update({
      where: { id },
      // 행 단위 INSERT 대신 한 번에 — 300행에서도 interactive transaction 기본 timeout (5s) 안
      data: { ...checkupData(input), results: { createMany: { data: [...rows] } } },
      select: { id: true },
    });
  });
}

export async function deleteCheckup(id: string): Promise<void> {
  await prisma.healthCheckup.delete({ where: { id } });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

/**
 * 검진 API 로그 — 건강 데이터를 서버 로그에 남기지 않는다 (Prisma 검증 에러 메시지는 입력 인자를 포함할 수 있다).
 * Prisma 에러는 종류 · 코드만, 그 외 (네트워크 · 런타임) 는 메시지까지.
 */
export function describeError(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return `PrismaKnown ${err.code}`;
  // 그 외 Prisma 에러 (CHECK 위반 등 Unknown 포함) 메시지에는 Postgres 의 "Failing row contains (…)" 가 실릴 수 있다
  if (err instanceof Error && err.name.startsWith("PrismaClient")) return err.name;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return typeof err;
}
