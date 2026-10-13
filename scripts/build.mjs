import { createRequire } from "node:module";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "../../modera/modera-app/package.json"));
const { build } = require("esbuild");
await rm(join(root, "dist"), { recursive: true, force: true });
await mkdir(join(root, "dist/ui"), { recursive: true });
await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["@modera/plugin-sdk"],
});
await cp(join(root, "ui"), join(root, "dist/ui"), { recursive: true });
