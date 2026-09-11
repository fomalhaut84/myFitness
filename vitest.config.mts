import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
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
