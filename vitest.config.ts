import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig } from "vitest/config";
import { vitePlugin } from "@mbler/mcx-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverMock = path.join(__dirname, "tests", "mocks", "minecraft-server.ts");

export default defineConfig({
  resolve: {
    alias: {
      // beta MCBE runtime packages cannot load under Node; unit tests only
      // need the import-time surface to exist
      "@minecraft/server": serverMock,
      "@minecraft/server-ui": serverMock,
    },
  },
  plugins: [
    vitePlugin(
      {
        // bare ids (e.g. @mbler/mcx injected by compiled .mcx) resolve here
        moduleDir: path.join(__dirname, "node_modules"),
        tsconfigPath: path.join(__dirname, "tsconfig.json"),
        sourcemap: false,
        ts,
      },
      // throwaway output dirs; tests never read them
      {
        dist: path.join(__dirname, ".mcx-out"),
        behavior: path.join(__dirname, ".mcx-out"),
        resources: path.join(__dirname, ".mcx-out"),
      },
    ),
  ],
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
