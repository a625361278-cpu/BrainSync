import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const outdir = resolve("dist-server");
mkdirSync(resolve(outdir, "data"), { recursive: true });

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: resolve(outdir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  packages: "external"
});

copyFileSync("src/server/data/idioms.json", resolve(outdir, "data/idioms.json"));
copyFileSync("src/server/data/songs.json", resolve(outdir, "data/songs.json"));
copyFileSync("src/server/data/character-silhouettes.json", resolve(outdir, "data/character-silhouettes.json"));
copyFileSync("src/server/data/movie-stills.json", resolve(outdir, "data/movie-stills.json"));
