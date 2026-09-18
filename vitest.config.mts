// #393 (M15-1): 회귀 테스트 러너. workflow.md 8-5 — `src/**/__tests__/**/*.test.ts`.
// 기존 verify 스크립트(scripts/verify-*.ts)는 소스 스캔 등 프레임워크로 잡기 어려운 검증용으로 유지.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
