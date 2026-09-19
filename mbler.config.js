// @ts-check
import { defineConfig } from "mbler";
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
// mbler config
// defineConfig is for IDE's auto-complete
export default defineConfig({
  // description: use in manifest generate
  description: "pack.description",
  // mcVersion: work on ... mcbe version, e.g 1.26.32
  mcVersion: "1.26.50",
  displayName: "pack.name",
  // out code minfiy mode, support: "terser" | "esbuild | "oxc" | false , "terser" | "esbuild" need install on project
  minify: "oxc",
  // out to game in dev(env.BUILD_MODULE != release)
  outGameOnDev: true,
  script: {
    main: "index.ts",
    ui: true,
    lang: "mcx",
    UseBeta: true,
  },
  build: {
    // should true
    bundle: true,
    cache: "file",
    rollupPlugins: [
      {
        name: "manifest.rewrite",
        buildEnd() {
          return new Promise((r) => {
            setTimeout(async () => {
              /**
               * @type {import("mbler").ManifestData}
               */
              const data = JSON.parse(
                await readFile(resolve("dist/dep/manifest.json"), "utf-8"),
              );
              // @ts-ignore
              data.dependencies[1].version = "2.3.0-beta";
              // @ts-ignore
              data.dependencies[1].version = "2.11.0-beta";
              await writeFile(
                resolve("dist/dep/manifest.json"),
                JSON.stringify(data, null, 2),
              );
              r();
            }, 20);
          });
        },
      },
    ],
  },
  outdir: {
    resources: "./dist/res",
    behavior: "./dist/dep",
    // only emit on env.BUILD_MODULE == release
    dist: "./dist.mcaddon",
  },
});
