import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const host = resolve(root, "../../modera/modera-app");
const require = createRequire(join(host, "package.json"));
const buildRoot = dirname(require.resolve("@modera/plugin-build"));
const { readPackageTree, decodePackage } = require(join(buildRoot, "package-codec.cjs"));
const { requiredHostCapabilities } = require("@modera/contracts");
const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
manifest.requiresHost = requiredHostCapabilities(manifest);
const tree = await readPackageTree(join(root, "dist"));
const files = Object.fromEntries(Object.entries(tree).map(([path, bytes]) => [
  `dist/${path}`, bytes.toString("base64"),
]));
files["plugin.json"] = Buffer.from(JSON.stringify(manifest)).toString("base64");
for (const file of ["LICENSE", "NOTICE"])
  files[file] = (await readFile(join(root, file))).toString("base64");
const bytes = gzipSync(JSON.stringify({
  format: 1,
  compatibility: { minHostVersion: "0.1.0", maxHostVersion: "0.2.0", platforms: ["any"] },
  files,
}), { level: 9 });
decodePackage(bytes);
const hash = createHash("sha256").update(bytes).digest("hex");
const output = join(root, "release", `${manifest.id}-${manifest.version}-${hash.slice(0, 12)}.moderax`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(output);
