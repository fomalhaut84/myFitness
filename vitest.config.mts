// #393 (M15-1): 회귀 테스트 러너. workflow.md 8-5 — `src/**/__tests__/**/*.test.ts`.
// 기존 verify 스크립트(scripts/verify-*.ts)는 소스 스캔 등 프레임워크로 잡기 어려운 검증용으로 유지.
// coverage 블록은 pleiades 1a-2(#374)에서 왔다 — 2026-09-28 dev 동기화(pleiades#71)에서 dev 판(alias)과 합침.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/bot/notifications/**/*.ts", "src/bot/utils/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/lib/prisma.ts"],
    },
  },
});
