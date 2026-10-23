import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Components render with react-dom/server in the node environment.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    environment: "node",
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    server: { deps: { inline: ["server-only"] } },
  },
  resolve: {
    alias: { "server-only": new URL("./tests/server-only-stub.ts", import.meta.url).pathname },
  },
});
